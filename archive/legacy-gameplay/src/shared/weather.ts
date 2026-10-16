import { withTimeoutSignal } from './compat'
import type { Fetch, Weather } from './ipc'

/** Redirects to wttr.in's JSON; an empty city locates by the caller's IP. */
const API = 'https://api.ankio.net/weather?city='

/** The fields used from wttr.in's reply; numbers come as strings, `time` as "0", "300" … "2100". */
interface Reply {
  current_condition: { weatherCode: string }[]
  weather: { maxtempC: string; mintempC: string; hourly: { time: string; weatherCode: string; windspeedKmph: string }[] }[]
}

/** Today's weather; rejects with the server's error, e.g. for an unknown city. */
export async function weather(fetch: Fetch, city: string): Promise<Weather> {
  return withTimeoutSignal(20_000, async (signal) => {
    const r = await fetch(API + encodeURIComponent(city), { signal })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 100)}`)
    const {
      current_condition: [now],
      weather: [today, tomorrow],
    } = (await r.json()) as Reply
    const hour = new Date().getHours()
    return {
      code: +now.weatherCode,
      max: +today.maxtempC,
      min: +today.mintempC,
      tomorrowMax: +tomorrow.maxtempC,
      hours: today.hourly.map((h) => ({ hour: +h.time / 100, code: +h.weatherCode, wind: +h.windspeedKmph })).filter((h) => h.hour + 3 > hour),
    }
  })
}
