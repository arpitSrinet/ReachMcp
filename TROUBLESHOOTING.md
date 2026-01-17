# Troubleshooting ngrok 503 Error

## Problem
Getting `503 Service Unavailable` when connecting to ngrok URL from ChatGPT web.

## Quick Fixes

### 1. Verify Server is Running
```bash
./check-server.sh
```

Or manually:
```bash
# Check if port 3000 is in use
lsof -i :3000

# Test server directly
curl -k https://localhost:3000/
```

### 2. Start Server (if not running)
```bash
npm run start:https
```

Or with dev UI:
```bash
npm run dev:ui
```

### 3. Start ngrok
```bash
./run-ngrok.sh
```

Or:
```bash
npm run ngrok
```

## Common Issues

### Issue 1: Server Not Running
**Symptom:** 503 error, port 3000 not in use

**Solution:**
```bash
npm run start:https
```

### Issue 2: ngrok Browser Warning
**Symptom:** ngrok shows warning page requiring "Visit Site" click

**Solution:** 
- This is normal for ngrok free tier
- Users must click "Visit Site" button
- Consider upgrading to paid ngrok plan to remove warning

### Issue 3: Wrong ngrok URL
**Symptom:** Using HTTP URL instead of HTTPS

**Solution:**
- Always use the **HTTPS** URL from ngrok (starts with `https://`)
- The URL format: `https://xxxx-xx-xx-xx-xx.ngrok-free.app`
- Use this URL in ChatGPT web MCP configuration

### Issue 4: Certificate Issues
**Symptom:** Server uses self-signed certificates

**Solution:**
- ngrok should handle this automatically
- If issues persist, regenerate certificates:
```bash
npm run generate-certs
```

### Issue 5: ngrok Not Authenticated
**Symptom:** ngrok shows authentication error

**Solution:**
```bash
# Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
ngrok config add-authtoken YOUR_TOKEN
```

## Testing Steps

1. **Check server locally:**
   ```bash
   curl -k https://localhost:3000/
   curl -k https://localhost:3000/mcp
   ```

2. **Check ngrok tunnel:**
   ```bash
   curl https://YOUR-NGROK-URL.ngrok-free.app/
   curl https://YOUR-NGROK-URL.ngrok-free.app/mcp
   ```

3. **Check ngrok status:**
   - Open http://localhost:4040 in browser
   - Check "Requests" tab for incoming requests
   - Check "Status" for tunnel health

## ChatGPT Web Configuration

When configuring in ChatGPT web:
- **URL:** `https://YOUR-NGROK-URL.ngrok-free.app/mcp`
- **Method:** POST
- **Protocol:** MCP (Model Context Protocol)

## Still Having Issues?

1. Check server logs for errors
2. Check ngrok web interface at http://localhost:4040
3. Verify ngrok tunnel is active (green status)
4. Test with curl to isolate the issue
5. Check firewall/network settings

