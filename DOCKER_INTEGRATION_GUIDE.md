# TLSOC Plugin Docker Integration Guide

This document explains how to integrate tlsocPlugin with your original Elasticsearch through Docker, for both production-style and development-style setup.

## 1. Choose Compatible Versions First

Your Kibana image version and plugin build target must match.

- If Kibana Docker image is 8.12.2, build plugin for 8.12.2.
- Do not mix plugin built for one Kibana version with another Kibana image.

## 2. Build Plugin Zip

From your local plugin source:

1. Go to plugin folder:
   - /home/darshan/Desktop/SOC_DASHBOARD/kibana/plugins/tlsocPlugin
2. Build plugin:
   - yarn build
3. Output zip is created in:
   - build/tlsocPlugin-<kibana-version>.zip

## 3. Production-Style Docker (Install Zip Inside Kibana Image)

Use this when you want stable deployment in org/prod.

### 3.1 Create Dockerfile for Kibana + Plugin

Create a file named Dockerfile.kibana-plugin:

```dockerfile
FROM docker.elastic.co/kibana/kibana:8.12.2

# Copy plugin zip into image
COPY tlsocPlugin-8.12.2.zip /tmp/tlsocPlugin.zip

# Install plugin
RUN /usr/share/kibana/bin/kibana-plugin install file:///tmp/tlsocPlugin.zip && \
    rm -f /tmp/tlsocPlugin.zip
```

Adjust versions and zip name to your actual build.

### 3.2 Build Docker Image

Run from folder containing Dockerfile.kibana-plugin and plugin zip:

```bash
docker build -f Dockerfile.kibana-plugin -t kibana-tlsoc:8.12.2 .
```

### 3.3 Run with Docker Compose

Create docker-compose.yml:

```yaml
version: "3.8"

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.2
    container_name: es-tlsoc
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=true
      - ELASTIC_PASSWORD=changeme
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data

  kibana:
    image: kibana-tlsoc:8.12.2
    container_name: kibana-tlsoc
    depends_on:
      - elasticsearch
    environment:
      - ELASTICSEARCH_HOSTS=["https://elasticsearch:9200"]
      - ELASTICSEARCH_USERNAME=elastic
      - ELASTICSEARCH_PASSWORD=changeme
      - ELASTICSEARCH_SSL_VERIFICATIONMODE=none
      - SERVER_PUBLICBASEURL=https://your-kibana-host:5601

      # Required for many Kibana features in production
      - XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=9f3a8c1e5d7b4a2f6c9d8e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8

      # tlsocPlugin mailer auto-config (optional but recommended)
      - TLSOC_SMTP_HOST=smtp.gmail.com
      - TLSOC_SMTP_PORT=587
      - TLSOC_SMTP_SECURE=false
      - TLSOC_SMTP_USERNAME=yourgmail@gmail.com
      - TLSOC_SMTP_PASSWORD=your-app-password
      - TLSOC_SMTP_FROM=yourgmail@gmail.com
      - TLSOC_ADMIN_EMAIL=security-team@yourorg.com
      - TLSOC_MAILER_POLL_SECONDS=30
    ports:
      - "5601:5601"
    volumes:
      # Important: keep this persistent, plugin stores mailer config here
      - kibana_data:/usr/share/kibana/data

volumes:
  es_data:
  kibana_data:
```

Start stack:

```bash
docker compose up -d
```

## 4. Integrate with Existing External Elasticsearch (Your Original Cluster)

If your original Elasticsearch already exists outside Docker:

1. Remove elasticsearch service from compose.
2. Point Kibana to your real cluster in environment:
   - ELASTICSEARCH_HOSTS=["https://10.130.171.246:9200"]
   - ELASTICSEARCH_USERNAME=<your-user>
   - ELASTICSEARCH_PASSWORD=<your-password>
   - ELASTICSEARCH_SSL_VERIFICATIONMODE=none (or proper CA config in production)

Minimal kibana-only service:

```yaml
services:
  kibana:
    image: kibana-tlsoc:8.12.2
    container_name: kibana-tlsoc
    environment:
      - ELASTICSEARCH_HOSTS=["https://10.130.171.246:9200"]
      - ELASTICSEARCH_USERNAME=Aryan
      - ELASTICSEARCH_PASSWORD=Aryan123
      - ELASTICSEARCH_SSL_VERIFICATIONMODE=none
      - XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=9f3a8c1e5d7b4a2f6c9d8e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8
      - TLSOC_SMTP_HOST=smtp.gmail.com
      - TLSOC_SMTP_PORT=587
      - TLSOC_SMTP_SECURE=false
      - TLSOC_SMTP_USERNAME=yourgmail@gmail.com
      - TLSOC_SMTP_PASSWORD=your-app-password
      - TLSOC_SMTP_FROM=yourgmail@gmail.com
      - TLSOC_ADMIN_EMAIL=darshanmutalikdesai46@gmail.com
      - TLSOC_MAILER_POLL_SECONDS=30
    ports:
      - "5601:5601"
    volumes:
      - kibana_data:/usr/share/kibana/data

volumes:
  kibana_data:
```

## 5. Development-Style Docker (Mount Source, Not Recommended for Prod)

Use this only for rapid development:

- Mount plugin source into Kibana plugins directory.
- Run watcher/dev commands inside container.
- This is slower and less stable than zip-install for production.

## 6. Verify Plugin and Mailer After Start

### 6.1 Plugin health

Open Kibana and check app list for tlsocPlugin.

### 6.2 Mailer status endpoint

```bash
curl -u elastic:changeme "http://localhost:5601/api/tlsoc_plugin/mailer/status" -H "kbn-xsrf: true"
```

Expected:

- smtpConfigured: true
- active: true

### 6.3 Force configure endpoint (if needed)

If env-based auto-config is not used, call configure API manually:

```bash
curl -u elastic:changeme -X POST "http://localhost:5601/api/tlsoc_plugin/mailer/configure" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  --data '{
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_secure": false,
    "smtp_username": "yourgmail@gmail.com",
    "smtp_password": "your-app-password",
    "smtp_from": "yourgmail@gmail.com",
    "admin_email": "security-team@yourorg.com",
    "poll_interval_seconds": 30
  }'
```

## 7. Production Notes (Important)

- Use app password (not normal account password) for Gmail SMTP.
- Keep Kibana data volume persistent so mailer configuration survives container restart.
- Use proper TLS CA and avoid verificationMode none in real production.
- Store secrets in Docker secrets or environment manager, not plaintext compose files.
- Match plugin build target version with Kibana Docker image version exactly.

## 8. Troubleshooting

1. Plugin install fails
- Cause: Kibana version mismatch.
- Fix: rebuild plugin zip for exact Kibana version.

2. Plugin visible but mail not triggering
- Check mailer status endpoint.
- Confirm alerts exist in either tlsoc-alerts-* or .alerts-security*.
- Confirm SMTP credentials and app password.

3. Works until container restart
- Cause: Kibana data folder not persisted.
- Fix: mount /usr/share/kibana/data as named volume.

4. Cannot connect to external Elasticsearch
- Verify network route from container to ES host.
- Verify credentials.
- Verify TLS settings.

---

If you want, I can also generate a ready-to-run docker-compose.yml and Dockerfile in this plugin folder using your exact current Elasticsearch host and credentials placeholders.