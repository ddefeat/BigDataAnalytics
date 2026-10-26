FROM python:3.12-slim
RUN pip install --no-cache-dir pymongo
WORKDIR /app
COPY . .
EXPOSE 8000
CMD ["python", "-u", "monitor.py"]
