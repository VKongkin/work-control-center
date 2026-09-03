"""Helper for PATCH-style partial updates.

The CRUD PUT endpoints originally required a complete object, so a UI action as
small as "mark this task in progress" had to resend every field - and any field
it omitted was overwritten with null. `make_partial` derives a schema where every
field is optional, and the endpoints merge the supplied fields onto the stored
row, leaving everything else untouched.
"""
from typing import Annotated, Optional, get_args, get_origin
from pydantic import BaseModel, create_model


def make_partial(model: type[BaseModel]) -> type[BaseModel]:
    fields = {}
    for name, f in model.model_fields.items():
        annotation = Optional[f.annotation]
        # Pydantic keeps Annotated metadata (string constraints, the date
        # coercion) beside the annotation. Rebuilding without it would quietly
        # drop those rules on partial updates - so a date the user cleared, or
        # a title they blanked, would behave differently on PUT than on POST.
        if f.metadata:
            annotation = Annotated[tuple([annotation, *f.metadata])]
        fields[name] = (annotation, None)
    return create_model(f"{model.__name__}Partial", **fields)


def merge(schema: type[BaseModel], db_obj, payload: BaseModel) -> BaseModel:
    """Overlay the set fields of `payload` onto the current DB row."""
    current = {c.name: getattr(db_obj, c.name) for c in db_obj.__table__.columns}
    current.update(payload.model_dump(exclude_unset=True))
    return schema(**current)


def _relax(annotation):
    """Drop Annotated metadata (StringConstraints and friends) from a type."""
    if get_origin(annotation) is Annotated:
        return get_args(annotation)[0]
    return annotation


def make_lenient(model: type[BaseModel]) -> type[BaseModel]:
    """Response-side twin of a schema: same fields, none of the input rules.

    Input validation and output validation are not the same job. A rule added
    today (titles must not be blank) must not make the API refuse to hand back
    a row saved yesterday - one such row would 500 the entire list endpoint and
    take the page down with it. Requests are validated strictly; responses
    report what is actually stored.
    """
    fields = {
        name: (Optional[_relax(f.annotation)], None)
        for name, f in model.model_fields.items()
    }
    return create_model(f"{model.__name__}Out", **fields)
