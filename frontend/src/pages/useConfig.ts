import { useEffect, useState } from 'react'
import { api, type Config } from '../api'

export const ENGINE_NAME: Record<Config['redshift']['engine'], string> = { redshift: 'Redshift', postgres: 'PostgreSQL' }

/** Display name of the configured database engine, for labels ("Redshift" until loaded). */
export function useEngineName() {
  const [name, setName] = useState(ENGINE_NAME.redshift)
  useEffect(() => {
    api.get<Config>('/api/config').then((c) => setName(ENGINE_NAME[c.redshift.engine]))
  }, [])
  return name
}

/** Loads one config section and exposes a typed setter + save. */
export function useConfigSection<K extends keyof Config>(section: K) {
  const [value, setValue] = useState<Config[K] | null>(null)
  useEffect(() => {
    api.get<Config>('/api/config').then((c) => setValue(c[section]))
  }, [section])
  const set = <F extends keyof Config[K]>(field: F, v: Config[K][F]) =>
    setValue((prev) => (prev ? { ...prev, [field]: v } : prev))
  const save = async () => {
    const saved = await api.put<Config[K]>(`/api/config/${section}`, value)
    setValue(saved)
    return saved
  }
  return { value, set, save }
}
