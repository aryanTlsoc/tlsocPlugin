# TLSOCDockerDeploy Custom Plugin Integration Guide

This document explains how to integrate and deploy your customized Kibana plugin into:
https://github.com/sankettaware16/TLSOCDockerDeploy.git

Goal:
Build a custom Kibana Docker image that already contains your plugin zip, then run that image in the TLSOCDockerDeploy stack.

## 1. Prerequisites

- TLSOCDockerDeploy repository cloned on target server under /opt/TLSOCDockerDeploy
- Working Docker and Docker Compose on the target machine
- Plugin zip already built from your source (example: tlsocPlugin-18.18.2.zip)
- Kibana image version in TLSOCDockerDeploy must match plugin build target version

## 2. Verify Plugin Build Version

From your plugin workspace, build and confirm zip name:

```bash
cd /home/darshan/Desktop/SOC_DASHBOARD/kibana/plugins/tlsocPlugin
yarn build
ls -lh build/
```

You should see a file similar to:

- tlsocPlugin-18.18.2.zip

Important:
If your Docker stack uses Kibana 8.12.2, plugin zip must be for 8.12.2.
If stack uses another version, rebuild accordingly.

## 3. Copy Plugin Zip to TLSOCDockerDeploy Server

Example:

```bash
scp /home/darshan/Desktop/SOC_DASHBOARD/kibana/plugins/tlsocPlugin/build/tlsocPlugin-18.18.2.zip <user>@<tlsoc-server-ip>:/tmp/
```

On server:

```bash
sudo mkdir -p /opt/TLSOCDockerDeploy/custom-plugins
sudo mv /tmp/tlsocPlugin-18.18.2.zip /opt/TLSOCDockerDeploy/custom-plugins/
```

## 4. Create Custom Kibana Dockerfile in TLSOCDockerDeploy

Create file:

- /opt/TLSOCDockerDeploy/Dockerfile.kibana.custom

Content:

```dockerfile
FROM docker.elastic.co/kibana/kibana:8.12.2

# Copy plugin zip into image
COPY custom-plugins/tlsocPlugin-18.18.2.zip /tmp/tlsocPlugin.zip

# Install plugin
RUN /usr/share/kibana/bin/kibana-plugin install file:///tmp/tlsocPlugin.zip && \
    rm -f /tmp/tlsocPlugin.zip
```

Change both version values if your stack uses a different Kibana version.

## 5. Build Custom Kibana Image

From TLSOCDockerDeploy root:

```bash
cd /opt/TLSOCDockerDeploy
sudo docker build -f Dockerfile.kibana.custom -t tlsoc-kibana-custom:8.12.2 .
```

Validate image:

```bash
sudo docker images | grep tlsoc-kibana-custom
```

## 6. Update Docker Compose to Use Custom Image

Open your compose file in TLSOCDockerDeploy (usually docker-compose.yml), then in kibana service:

1) Replace kibana image line with:

- image: tlsoc-kibana-custom:8.12.2

2) Ensure environment includes your Elasticsearch and TLS settings used by your deployment.

3) Keep Kibana data volume mounted for persistence.

Example kibana service section:

```yaml
kibana:
  image: tlsoc-kibana-custom:8.12.2
  container_name: kibana
  depends_on:
    - elasticsearch
  ports:
    - "5601:5601"
  environment:
    - ELASTICSEARCH_HOSTS=["https://elasticsearch:9200"]
    - ELASTICSEARCH_USERNAME=kibana_system
    - ELASTICSEARCH_PASSWORD=${KIBANA_PASSWORD}
    - ELASTICSEARCH_SSL_VERIFICATIONMODE=certificate
    - XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=${ENCRYPTED_SAVED_OBJECTS_KEY}

    # Optional plugin mailer auto-config
    - TLSOC_SMTP_HOST=smtp.gmail.com
    - TLSOC_SMTP_PORT=587
    - TLSOC_SMTP_SECURE=false
    - TLSOC_SMTP_USERNAME=${TLSOC_SMTP_USERNAME}
    - TLSOC_SMTP_PASSWORD=${TLSOC_SMTP_PASSWORD}
    - TLSOC_SMTP_FROM=${TLSOC_SMTP_FROM}
    - TLSOC_ADMIN_EMAIL=${TLSOC_ADMIN_EMAIL}
    - TLSOC_MAILER_POLL_SECONDS=30
  volumes:
    - kibana_data:/usr/share/kibana/data
```

## 7. Deploy Updated Stack

From TLSOCDockerDeploy root:

```bash
cd /opt/TLSOCDockerDeploy
sudo docker compose down
sudo docker compose up -d
```

Check container health:

```bash
sudo docker ps
sudo docker logs kibana -f
```

## 8. Verify Plugin Installed in Running Container

Run:

```bash
sudo docker exec -it kibana /usr/share/kibana/bin/kibana-plugin list | grep -i tlsoc
```

Expected output includes your plugin id.

## 9. Verify in UI

Open:

https://<tlsoc-server-ip>:5601

Check:

- Plugin app is visible
- Dashboard loads
- View Logs button redirects to Discover as configured
- Mailer status API returns active and smtpConfigured true (if SMTP configured)

## 10. Upgrade Procedure (When Plugin Changes)

Each time you update plugin code:

1) Rebuild zip from source
2) Copy new zip to /opt/TLSOCDockerDeploy/custom-plugins
3) Update Dockerfile plugin zip filename if changed
4) Rebuild custom image
5) Restart stack

Commands:

```bash
# Rebuild plugin locally
cd /home/darshan/Desktop/SOC_DASHBOARD/kibana/plugins/tlsocPlugin
yarn build

# Copy to server
scp build/tlsocPlugin-18.18.2.zip <user>@<tlsoc-server-ip>:/tmp/

# On server
sudo mv /tmp/tlsocPlugin-18.18.2.zip /opt/TLSOCDockerDeploy/custom-plugins/
cd /opt/TLSOCDockerDeploy
sudo docker build -f Dockerfile.kibana.custom -t tlsoc-kibana-custom:8.12.2 .
sudo docker compose up -d --force-recreate kibana
```

## 11. Common Issues and Fixes

1) Plugin install fails during image build
- Cause: Kibana version mismatch
- Fix: Match plugin build target and base Kibana image version exactly

2) Kibana starts but plugin missing
- Cause: old image still used by compose
- Fix: confirm compose points to tlsoc-kibana-custom image and run force recreate

3) Kibana auth fails after restart
- Cause: first-time password reset not reflected in .env
- Fix: reset elastic and kibana_system passwords, update .env, restart stack

4) Mailer not sending in production
- Cause: SMTP env missing or invalid app password
- Fix: check kibana logs and plugin mailer status endpoint

## 12. Recommended Production Practices

- Keep plugin zip and Dockerfile under version control in a private repo
- Store SMTP and sensitive values in .env or secrets manager, not hardcoded in compose
- Use certificate verification mode with proper CA in production
- Keep kibana_data and elasticsearch data volumes persistent
- Test plugin image in staging before prod rollout

---

If you want, next I can generate exact ready-to-use files for your repo:

1. Dockerfile.kibana.custom
2. docker-compose override for custom Kibana image
3. .env.example additions for plugin mailer variables
