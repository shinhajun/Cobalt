# Security Policy

## Reporting Security Issues

If you discover a security vulnerability in Cobalt Browser, please report it by emailing the maintainers or opening a private security advisory on GitHub.

**Please do not open public issues for security vulnerabilities.**

---

## Supported Versions

Only the latest version of Cobalt Browser receives security updates.

---

## Security Best Practices

### For Users

1. **Protect Your API Keys**
   - Never share your `.env` file
   - Keep API keys private and secure
   - Rotate keys regularly
   - Use separate keys for development and production

2. **Review Before Sharing**
   - Check macros for sensitive data before sharing
   - Verify no personal information in screenshots
   - Remove debug files before publishing

3. **Use Responsibly**
   - Only automate tasks you're authorized to perform
   - Respect website terms of service
   - Don't use for malicious purposes

### For Contributors

1. **Code Review**
   - Never commit API keys or credentials
   - Check `.gitignore` includes sensitive files
   - Review changes for security implications
   - Use environment variables for all secrets

2. **Dependencies**
   - Keep dependencies up to date
   - Review security advisories regularly
   - Use `npm audit` to check for vulnerabilities

3. **Data Handling**
   - Minimize data collection
   - Encrypt sensitive data at rest
   - Clear temporary files appropriately

---

## Files That Should NEVER Be Committed

### Critical (API Keys & Credentials)
- `.env`
- `*.env` (except `.env.example`)
- Any file containing API keys or passwords

### User Data
- `debug/` (screenshots may contain sensitive info)
- `output/` (saved files)
- `macros/*.json` (may contain personal data)
- `autofill-profiles.json`
- `browsing-history.json`
- `storageState.json` (browser session data)

### Build & Runtime
- `node_modules/`
- `dist/`
- `*.log`
- Session and cache files

---

## Security Features

### Current Security Measures

1. **API Key Protection**
   - Keys stored in `.env` (excluded from git)
   - No hardcoded credentials in source code
   - Keys only accessible to main Electron process

2. **Data Isolation**
   - Local-only execution
   - No external data transmission (except to AI APIs)
   - Session data cleared on exit

3. **Secure Defaults**
   - HTTPS enforced where possible
   - Sandboxed browser contexts
   - Minimal permissions requested

### Known Limitations

1. **API Key Security**
   - Keys are stored in plaintext in `.env`
   - Consider using system keychain for production

2. **Browser Automation**
   - Playwright has access to page content
   - Screenshots may contain sensitive information
   - User is responsible for data handled by macros

3. **Third-Party APIs**
   - Data sent to OpenAI/Google/Anthropic for processing
   - Review their privacy policies

---

## Vulnerability Disclosure Timeline

- **Day 0**: Vulnerability reported privately
- **Day 1-7**: Maintainers investigate and confirm issue
- **Day 7-30**: Develop and test fix
- **Day 30**: Release patch and public disclosure

---

## Security Checklist for Public Release

Before making the repository public:

- [ ] Verify `.env` is not committed
- [ ] Check no API keys in code
- [ ] Remove `debug/` folder from git
- [ ] Remove personal data from examples
- [ ] Update `.gitignore` comprehensively
- [ ] Include `.env.example` template
- [ ] Document security practices in README
- [ ] Add this SECURITY.md file
- [ ] Review all commit history for sensitive data

---

## Contact

For security-related questions or concerns, please contact the maintainers through GitHub.

---

**Last Updated**: November 2025
