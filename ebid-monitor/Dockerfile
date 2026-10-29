FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

WORKDIR /app

RUN pip install --no-cache-dir \
    httpx \
    pyyaml \
    playwright==1.48.0 \
    beautifulsoup4

CMD ["python", "src/main.py"]
