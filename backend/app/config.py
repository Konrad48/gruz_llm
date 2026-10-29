from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    database_url: str = "postgresql+psycopg://gruz:gruz@127.0.0.1:5432/gruz"
    openai_api_key: str = ""
    chat_model: str = "openai:gpt-4.1-mini"
    embedding_model: str = "text-embedding-3-small"
    upload_dir: str = "data/uploads"


settings = Settings()
