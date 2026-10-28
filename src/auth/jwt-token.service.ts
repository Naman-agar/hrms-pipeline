// TPRD 02 §2 — access-token design: JWT, RS256, TTL `ACCESS_TOKEN_TTL`.
//
// Claims are `{ sub: userId, role: roleName, perms: string[], iat, exp }`. The token
// is never stored server-side; it is signed with `JWT_PRIVATE_KEY` and verified with
// `JWT_PUBLIC_KEY` only (§2, §4.1 step 2).
//
// This service is a thin wrapper around `jsonwebtoken`. It deliberately does NOT
// translate verification failures into `AppError`: §4.1 step 2 makes that the
// `JwtAuthGuard`'s job ("failure/expiry → 401 UNAUTHENTICATED"), so `verify()`
// simply lets the library's `JsonWebTokenError` / `TokenExpiredError` propagate.
//
// Keys and TTLs come from the typed `Config` object, never from `process.env`
// (CLAUDE.md). Per TPRD 01 §3 (`.env.example`) both keys are "RS256 PEM,
// base64-encoded single line", so they are base64-decoded here into PEM text.
import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { CONFIG, type Config } from '../config/config';

/** Claims the caller supplies; `iat`/`exp` are added by the library on sign. */
export interface AccessTokenPayload {
  sub: string;
  role: string;
  perms: string[];
}

/** Claims as read back from a verified token (§2). */
export interface AccessTokenClaims extends AccessTokenPayload {
  iat: number;
  exp: number;
}

const ALGORITHM = 'RS256' as const;

/** Decode a base64 single-line PEM from the environment and sanity-check it. */
function decodePem(name: 'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY', encoded: string): string {
  const pem = Buffer.from(encoded, 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN')) {
    throw new Error(`${name} must be a base64-encoded PEM (decoded value is not a PEM block)`);
  }
  return pem;
}

@Injectable()
export class JwtTokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly accessTokenTtl: StringValue;

  constructor(@Inject(CONFIG) config: Config) {
    this.privateKey = decodePem('JWT_PRIVATE_KEY', config.JWT_PRIVATE_KEY);
    this.publicKey = decodePem('JWT_PUBLIC_KEY', config.JWT_PUBLIC_KEY);
    // Config keeps the TTL as a raw duration string (`15m`); jsonwebtoken parses it
    // via `ms`, so narrow the type here rather than re-implementing the parser.
    this.accessTokenTtl = config.ACCESS_TOKEN_TTL as StringValue;
  }

  // §2 — sign with the private key, RS256, `expiresIn = ACCESS_TOKEN_TTL`.
  // `iat` and `exp` are set by the library; the payload carries only `sub`/`role`/`perms`.
  sign(payload: AccessTokenPayload): string {
    const { sub, role, perms } = payload;
    return jwt.sign({ sub, role, perms }, this.privateKey, {
      algorithm: ALGORITHM,
      expiresIn: this.accessTokenTtl,
    });
  }

  // §4.1 step 2 — `jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] })`.
  // Throws on a bad signature, wrong algorithm, malformed token or expiry; the guard
  // maps those to 401 UNAUTHENTICATED.
  verify(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.publicKey, { algorithms: [ALGORITHM] });
    // With `algorithms` pinned and no `complete` option the library returns the
    // payload object; a string payload is impossible for tokens we signed.
    return decoded as AccessTokenClaims;
  }
}
