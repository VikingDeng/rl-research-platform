from pydantic import BaseModel, ConfigDict


def to_camel(value: str) -> str:
    parts = value.split('_')
    return parts[0] + ''.join(word.capitalize() for word in parts[1:])


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
