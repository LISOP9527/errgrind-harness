/**
 * Deployment-declared local page authorities. A bare hostname entry matches
 * that host and every subdomain of it: the declared zone names the
 * operator's own serving surface, so a page under it reaches the same
 * privileged Client state a loopback page would (Host persistence, document
 * controls). Entries are validated by `assertLocalAuthority` at the config
 * boundary and again before Client install; this matcher consumes only
 * canonical lowercase hostnames.
 * @module @deepseek-ai/dsh-client-connection/local-authority
 */

/**
 * Assert one configured `localAuthorities` entry is a bare canonical
 * hostname with no explicit port. Unlike `trustedHosts`, a port-qualified
 * entry is refused: page-location ports elide under the scheme's default,
 * so a port grant could never bind predictably, and the declared semantic
 * is the operator's own surface, not a socket. URL parts beyond the
 * authority, stripped whitespace, wildcard labels (`*` survives the WHATWG
 * parse unchanged yet no `location.hostname` ever carries it, so a
 * wildcard-looking grant would silently match nothing), and non-canonical
 * host spellings fail loudly here rather than silently matching or being
 * ignored.
 * @param entry - the configured value, verbatim.
 */
export function assertLocalAuthority(entry: string): void {
  let entryUrl: URL | undefined
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty
    // hostname or throws.
    entryUrl = new URL(`http://${entry}`)
  } catch {
    entryUrl = undefined
  }
  if (entryUrl !== undefined && !entry.includes('*')
    && entryUrl.hostname === entry.toLowerCase() && entryUrl.port === '') return
  throw new Error(`client-connection: localAuthorities entry ${JSON.stringify(entry)} is not a bare canonical hostname`)
}

/**
 * Read the `__DSH_LOCAL_AUTHORITIES__` page global into validated entries.
 * @param value - raw injected global value.
 * @returns canonical hostnames; an absent or empty value resolves to none.
 */
export function resolveLocalAuthorities(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError('client-connection: __DSH_LOCAL_AUTHORITIES__ is not an array')
  }
  const entries = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new TypeError('client-connection: __DSH_LOCAL_AUTHORITIES__ contains a non-string entry')
    }
    assertLocalAuthority(entry)
    return entry.toLowerCase()
  })
  return entries
}

/**
 * Whether a page hostname falls under a configured `localAuthorities`
 * entry: exact match, or a subdomain of the entry.
 * @param hostname - the page's `location.hostname`, lowercased by the platform.
 * @param localAuthorities - canonical bare hostnames from plugin configuration.
 * @returns true when the page sits inside a declared local zone.
 */
export function isLocalAuthorityHostname(hostname: string, localAuthorities: readonly string[]): boolean {
  const lower = hostname.toLowerCase()
  return localAuthorities.some(
    authority => lower === authority || lower.endsWith(`.${authority}`),
  )
}
