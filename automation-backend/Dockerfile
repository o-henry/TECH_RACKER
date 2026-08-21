FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY config ./config
COPY seed ./seed
COPY scripts ./scripts
COPY entrypoint.sh ./entrypoint.sh

RUN addgroup --system app && adduser --system --ingroup app app \
    && pip install --upgrade pip \
    && pip install . \
    && chmod +x /app/entrypoint.sh \
    && chown -R app:app /app

USER app

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
