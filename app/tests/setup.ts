import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18n from '../src/i18n'

await i18n.changeLanguage('en')
afterEach(cleanup)
