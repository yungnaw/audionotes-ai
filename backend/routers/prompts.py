"""Prompt template CRUD endpoints. User-scoped named templates."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import PromptTemplate, User
from ..models.schemas import PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateResponse
from ..services.auth_service import get_current_user

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.get("", response_model=list[PromptTemplateResponse])
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(PromptTemplate)
        .filter(PromptTemplate.user_id == current_user.id)
        .order_by(PromptTemplate.updated_at.desc())
        .all()
    )


@router.post("", response_model=PromptTemplateResponse)
def create_template(
    req: PromptTemplateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = PromptTemplate(
        user_id=current_user.id,
        name=req.name,
        content=req.content,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t.to_dict()


@router.put("/{template_id}", response_model=PromptTemplateResponse)
def update_template(
    template_id: str,
    req: PromptTemplateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = (
        db.query(PromptTemplate)
        .filter(PromptTemplate.id == template_id, PromptTemplate.user_id == current_user.id)
        .first()
    )
    if not t:
        raise HTTPException(404, "模板不存在或无权限")
    if req.name is not None:
        t.name = req.name
    if req.content is not None:
        t.content = req.content
    db.commit()
    db.refresh(t)
    return t.to_dict()


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = (
        db.query(PromptTemplate)
        .filter(PromptTemplate.id == template_id, PromptTemplate.user_id == current_user.id)
        .first()
    )
    if not t:
        raise HTTPException(404, "模板不存在或无权限")
    db.delete(t)
    db.commit()
    return {"status": "ok"}
