# --------------------------------------------------------------------
# Fantacalcio Manager — Backend (FastAPI + Motor MongoDB)
# Portable image usable on Render, Fly.io, Railway, Google Cloud Run, etc.
# --------------------------------------------------------------------
FROM python:3.11-slim

# System deps for bcrypt / cryptography wheels + healthcheck curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# The listone.json (loaded at startup) lives inside /app/data
# All *.env variables are injected by the platform (Render/Fly/Railway).

ENV PORT=8001
EXPOSE 8001

# Health check hits our public root endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/api/ || exit 1

# In production, use a single worker per instance (Free tiers = 512 MB RAM).
# Scale horizontally instead of raising workers.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
