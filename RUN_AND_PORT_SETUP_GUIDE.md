# TLSOC Plugin Build and Run Guide (Port Setup Included)

This guide explains how to set the port, build Kibana, run Kibana, and configure SMTP for the tlsocPlugin on Linux.

## 1. Prerequisites

1. Open a terminal.
2. Go to Kibana folder:
   cd /home/darshan/Desktop/SOC_DASHBOARD/kibana
3. Use Node 18.18.2:
   nvm use 18.18.2
4. Verify yarn works:
   yarn -v

## 2. Kill Existing Processes and Free the Port

If port 5601 is already in use, clean everything first.

1. Kill old Kibana or node processes:
   pkill -f "node.*kibana" || true
   pkill -f "yarn.*start" || true
2. Force free port 5601:
   lsof -ti:5601 | xargs kill -9 2>/dev/null || true
3. Check port is free:
   lsof -i :5601

If nothing is shown, port is free.

## 3. Bootstrap (Build Dependencies)

Run bootstrap from Kibana root:

yarn kbn bootstrap

If bootstrap fails, confirm you are inside:
/home/darshan/Desktop/SOC_DASHBOARD/kibana

## 4. Start Kibana on Custom Port 5601

Use this exact command:

yarn start --dev --server.port=5601 --elasticsearch.hosts=https://10.130.171.246:9200 --elasticsearch.username=Aryan --elasticsearch.password=Aryan123 --elasticsearch.ssl.verificationMode=none --xpack.encryptedSavedObjects.encryptionKey=9f3a8c1e5d7b4a2f6c9d8e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8

## 5. Wait Until Kibana Is Ready

During startup, you may see:
Kibana server is not ready so requests have been paused

This is normal while Kibana connects to Elasticsearch.

Proceed only when logs indicate Kibana is running and ready.

## 6. Verify Elasticsearch Connectivity (If Startup Hangs)

If you get timeout errors like Unable to retrieve version information from Elasticsearch nodes, test Elasticsearch directly:

curl -k -u Aryan:Aryan123 https://10.130.171.246:9200

If this command times out or fails, Kibana cannot start until Elasticsearch connectivity is fixed.

## 7. Configure SMTP for tlsocPlugin

After Kibana is fully ready, run configure first:

curl -u Aryan:Aryan123 -X POST "http://localhost:5601/api/tlsoc_plugin/mailer/configure" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  --data '{
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_secure": false,
    "smtp_username": "yourgmail@gmail.com",
    "smtp_password": "your-app-password",
    "smtp_from": "yourgmail@gmail.com",
    "admin_email": "darshanmutalikdesai46@gmail.com",
    "poll_interval_seconds": 30
  }'

Important: activate fails unless configure succeeds first.

## 8. Activate Mailer

curl -u Aryan:Aryan123 -X POST "http://localhost:5601/api/tlsoc_plugin/mailer/activate" \
  -H "kbn-xsrf: true"

## 9. Check Mailer Status

curl -u Aryan:Aryan123 "http://localhost:5601/api/tlsoc_plugin/mailer/status" \
  -H "kbn-xsrf: true"

Expected values after success:
- smtpConfigured: true
- active: true

## 10. Common Errors and Fixes

1. Error: 401 Unauthorized
- Cause: request sent without valid Kibana auth.
- Fix: include -u username:password or use logged-in session.

2. Error: 500 SMTP is not configured
- Cause: activate called before configure.
- Fix: call configure first, then activate.

3. Error: 404 Not Found on configure
- Cause: wrong method or wrong URL.
- Fix: use POST and exact path /api/tlsoc_plugin/mailer/configure.

4. Error: Kibana not ready / paused requests
- Cause: Kibana still booting or Elasticsearch unreachable.
- Fix: wait for ready logs and verify ES with curl command.

5. Error: Could not find package.json
- Cause: command run from wrong directory.
- Fix: run all Kibana commands from:
  /home/darshan/Desktop/SOC_DASHBOARD/kibana

## 11. Quick Daily Run Sequence

1. cd /home/darshan/Desktop/SOC_DASHBOARD/kibana
2. nvm use 18.18.2
3. pkill old processes and free 5601
4. yarn kbn bootstrap
5. yarn start with --server.port=5601 and Elasticsearch options
6. wait until Kibana ready
7. configure mailer
8. activate mailer
9. verify status

---

If you follow this order exactly, the environment starts reliably and SMTP activation works.