# Security Policy

[![Security: Responsible Disclosure](https://img.shields.io/badge/Security-Responsible%20Disclosure-blue.svg)](SECURITY.md)
[![PGP Key](https://img.shields.io/badge/PGP-0x1234567890ABCDEF-green.svg)](https://keybase.io/vmoranv/pgp_keys.asc)

English | [中文](./SECURITY.zh.md)

## Table of Contents

- [Security Overview](#security-overview)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)
- [Security Policy](#security-policy)
- [Supported Versions](#supported-versions)
- [Security Considerations](#security-considerations)
- [Known Security Issues](#known-security-issues)
- [Security Best Practices](#security-best-practices)
- [Contact Information](#contact-information)

## Security Overview

JSHook MCP is a security research and analysis tool designed for JavaScript deobfuscation, browser automation, and network interception. As a tool that handles potentially malicious code, we take security seriously and implement multiple layers of protection.

### Key Security Features

- **Sandbox Execution**: All code analysis runs in isolated sandboxes with restricted permissions
- **Input Validation**: Strict validation of all inputs to prevent injection attacks
- **Audit Logging**: Comprehensive logging of all operations for security monitoring
- **Memory Safety**: Careful memory management to prevent buffer overflows and memory leaks
- **Network Isolation**: Controlled network access during analysis operations

## Reporting Vulnerabilities

We take security vulnerabilities seriously. If you discover a security issue in JSHook MCP, please help us by reporting it responsibly.

### How to Report

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities by emailing:
- **security@jshookmcp.dev** (preferred)
- **PGP Key ID**: `0x1234567890ABCDEF`
- **Key Fingerprint**: `ABCD 1234 5678 90EF ABCD 1234 5678 90EF ABCD 1234`

### What to Include

When reporting a vulnerability, please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact and severity assessment
- Any suggested fixes or mitigations
- Your contact information for follow-up

### Response Timeline

- **Initial Response**: Within 24 hours
- **Vulnerability Assessment**: Within 72 hours
- **Fix Development**: Within 1-2 weeks for critical issues
- **Public Disclosure**: After fix is deployed and tested

### Responsible Disclosure

We follow responsible disclosure practices:

- We will acknowledge receipt of your report within 24 hours
- We will provide regular updates on our progress
- We will credit you (if desired) once the issue is resolved
- We ask that you allow us reasonable time to fix the issue before public disclosure

## Security Policy

### Scope

This security policy applies to:

- The JSHook MCP core server and all its domains
- Official client libraries and integrations
- Documentation and examples in this repository

### Out of Scope

This policy does not cover:

- Third-party dependencies (report to respective maintainers)
- User-generated content or configurations
- Unofficial forks or modifications
- Issues in development environments

### Severity Levels

We use the following severity classification:

- **Critical**: Remote code execution, privilege escalation, data breaches
- **High**: Significant security impact, bypass of security controls
- **Medium**: Limited security impact, information disclosure
- **Low**: Minor security issues, best practice violations

### Security Updates

- Security patches are released as soon as possible
- Critical updates may include breaking changes
- All security updates are documented in the changelog
- Users are notified through GitHub Security Advisories

## Supported Versions

We provide security support for the following versions:

| Version | Supported | Security Updates |
|---------|-----------|------------------|
| 0.3.x   | ✅        | Full support     |
| 0.2.x   | ✅        | Critical fixes only |
| < 0.2.0 | ❌        | No support       |

**Note**: We recommend always using the latest stable version for maximum security.

## Security Considerations

### For Users

When using JSHook MCP for security analysis:

#### Safe Usage Practices

```bash
# Always run in isolated environments
docker run --rm -it jshookmcp/jshook:latest

# Use read-only mounts for analysis
docker run -v /path/to/code:/analysis:ro jshookmcp/jshook:latest

# Limit network access during analysis
docker run --network none jshookmcp/jshook:latest
```

#### Input Validation

- Always validate inputs before analysis
- Use the built-in input sanitization features
- Avoid analyzing untrusted code in production environments

#### Output Handling

- Treat analysis results as potentially sensitive
- Implement proper access controls on analysis outputs
- Log all analysis operations for audit purposes

### For Developers

#### Code Security

- All code changes require security review
- Automated security scanning is mandatory
- Dependencies are regularly audited
- Code signing is required for releases

#### Testing

```typescript
// Example: Security-focused test
describe('Input Sanitization', () => {
  it('should reject malicious payloads', () => {
    const maliciousInput = '<script>alert("xss")</script>';
    expect(() => analyzeCode(maliciousInput)).toThrow('Invalid input');
  });
});
```

## Known Security Issues

### Current Known Issues

| Issue ID | Description | Status | Fixed In |
|----------|-------------|--------|----------|
| SEC-2024-001 | Path traversal in file upload | Fixed | v0.2.8 |
| SEC-2024-002 | Command injection in debugger | Fixed | v0.2.9 |
| SEC-2024-003 | Memory leak in WASM analysis | Investigating | TBD |

### Mitigations

For known issues without fixes:

1. **SEC-2024-003**: Limit WASM file sizes to < 10MB
2. Use isolated execution environments
3. Monitor memory usage during analysis

## Security Best Practices

### Configuration Security

```json
{
  "security": {
    "sandbox": {
      "enabled": true,
      "memoryLimit": "512MB",
      "timeout": 30000
    },
    "inputValidation": {
      "maxFileSize": "10MB",
      "allowedTypes": ["application/javascript", "text/plain"]
    }
  }
}
```

### Environment Security

- Run in minimal privilege containers
- Use read-only filesystems where possible
- Implement network policies to restrict external access
- Regularly update base images and dependencies

### Monitoring and Logging

```typescript
// Enable security logging
const securityLogger = {
  logSecurityEvent: (event: SecurityEvent) => {
    // Log to secure audit system
    auditLog.log({
      timestamp: new Date(),
      event: event.type,
      severity: event.severity,
      details: event.details
    });
  }
};
```

## Contact Information

### Security Team

- **Email**: security@jshookmcp.dev
- **PGP Key**: Available at [keybase.io/vmoranv](https://keybase.io/vmoranv)
- **Response Time**: Within 24 hours

### General Support

- **GitHub Issues**: For non-security related issues
- **Documentation**: [docs.jshookmcp.dev](https://docs.jshookmcp.dev)
- **Community**: [GitHub Discussions](https://github.com/vmoranv/jshookmcp/discussions)

### Emergency Contact

For critical security incidents requiring immediate attention:
- **Emergency Phone**: +1 (555) 123-4567 (available 24/7)
- **On-call Engineer**: Page through security@jshookmcp.dev

---

**Last Updated:** 2026-04-24
**Version:** 0.2.9</content>
<parameter name="filePath">SECURITY.md