/** Typographic brand components for ErrGrind. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './Brand.module.css'

/**
 * Render the ErrGrind typographic mark in the expanded brand row and collapsed rail.
 * @param props - Host-supplied mark geometry.
 * @returns the ErrGrind typographic mark SVG element.
 */
export function ErrGrindBrandMark({ size, t }: SidebarBrandMarkOwnerProps & PropsLocale<typeof NS>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={css.mark}
    >
      <rect width="24" height="24" rx="5" fill="currentColor" fillOpacity="0.12" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="11"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.02em"
      >
        {t('brand.mark')}
      </text>
    </svg>
  )
}

/**
 * Render the ErrGrind typographic mark for the conversation hero headline.
 * @param props - Host-supplied mark geometry and optional class name.
 * @returns the ErrGrind hero typographic mark SVG element.
 */
export function ErrGrindHeroBrandMark({ size, className, t }: HeroBrandMarkOwnerProps & PropsLocale<typeof NS>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
      className={className ? `${css.heroMark} ${className}` : css.heroMark}
    >
      <rect width="34" height="34" rx="7" fill="currentColor" fillOpacity="0.12" />
      <text
        x="17"
        y="23.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="15"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.02em"
      >
        {t('brand.mark')}
      </text>
    </svg>
  )
}

/**
 * Render the ErrGrind name wordmark beside the brand mark.
 * @param props - Locale translation prop.
 * @returns the ErrGrind brand name element.
 */
export function ErrGrindBrandName({ t }: SidebarBrandNameOwnerProps & PropsLocale<typeof NS>) {
  return (
    <span className={css.name}>
      {t('brand.name')}
    </span>
  )
}
