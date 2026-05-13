"""Authentication endpoints: register, login, profile management."""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import User, UserRole, AudioFile, TaskGroup
from ..models.schemas import (
    UserRegisterRequest, ChangePasswordRequest,
    UpdateProfileRequest, TokenResponse,
)
from ..services.auth_service import (
    hash_password, verify_password,
    create_access_token, get_current_user,
)
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_response(user: User) -> dict:
    token = create_access_token(user.id, user.role.value)
    return {"access_token": token, "token_type": "bearer", "user": user.to_dict()}


# ===== Register =====

@router.post("/register", response_model=TokenResponse)
def register(req: UserRegisterRequest, db: Session = Depends(get_db)):
    """
    Register a new user account.
    - First registered user automatically becomes admin.
    - When ALLOW_REGISTRATION=False, a valid invite_code is required.
    """
    # Invite-code gate
    if not settings.ALLOW_REGISTRATION:
        if not settings.INVITE_CODE or req.invite_code != settings.INVITE_CODE:
            raise HTTPException(403, "注册已关闭，请提供有效的邀请码")

    if len(req.username) < 2 or len(req.username) > 32:
        raise HTTPException(400, "用户名长度需在 2-32 个字符之间")
    if len(req.password) < 6:
        raise HTTPException(400, "密码长度至少 6 位")

    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(400, "该用户名已被占用")
    if req.email and db.query(User).filter(User.email == req.email).first():
        raise HTTPException(400, "该邮箱已被注册")

    is_first_user = db.query(User).count() == 0
    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role=UserRole.ADMIN if is_first_user else UserRole.USER,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"New user registered: {user.username} (role={user.role.value})")
    return _token_response(user)


# ===== Login =====

@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login with username + password. Returns JWT access token."""
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(403, "账号已被禁用，请联系管理员")

    # Migrate legacy orphan data to the first admin upon login
    if user.role == UserRole.ADMIN:
        try:
            orphan_files = db.query(AudioFile).filter(AudioFile.user_id == None).count()
            if orphan_files > 0:
                db.query(AudioFile).filter(AudioFile.user_id == None).update({"user_id": user.id})
                db.query(TaskGroup).filter(TaskGroup.user_id == None).update({"user_id": user.id})
                db.commit()
                logger.info(f"Migrated legacy orphan data to admin {user.username}")
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to migrate legacy data: {e}")

    return _token_response(user)


# ===== Current User =====

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user profile."""
    return current_user.to_dict()


@router.put("/me/profile")
def update_profile(
    req: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update email or avatar."""
    if req.email and req.email != current_user.email:
        if db.query(User).filter(User.email == req.email, User.id != current_user.id).first():
            raise HTTPException(400, "该邮箱已被使用")
        current_user.email = req.email
    if req.avatar_url is not None:
        current_user.avatar_url = req.avatar_url
    db.commit()
    return current_user.to_dict()


@router.put("/me/password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change password. Requires old password verification."""
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(400, "原密码错误")
    if len(req.new_password) < 6:
        raise HTTPException(400, "新密码长度至少 6 位")
    current_user.password_hash = hash_password(req.new_password)
    db.commit()
    return {"ok": True, "message": "密码修改成功"}


@router.post("/logout")
def logout():
    """
    Logout hint. JWT is stateless — actual invalidation is done client-side
    by removing the token from localStorage.
    """
    return {"ok": True, "message": "已登出，请在客户端清除 Token"}
