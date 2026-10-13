// Generate a music bed with Google Lyria (Gemini API). LYRIA_MODEL picks the model (default lyria-3.5).
// usage: GEMINI_API_KEY=... node tools/video/music.mjs <out.mp3> ["prompt"]
// Same idea as the music in Craftspace's "Gus Cannot Whisper" film (there via OpenRouter; here straight from Gemini).
import { writeFileSync } from 'node:fs'

const [out, custom] = process.argv.slice(2)
const key = process.env.GEMINI_API_KEY
if (!out || !key) throw new Error('usage: GEMINI_API_KEY=... node tools/video/music.mjs <out.mp3> ["prompt"]')

const prompt = custom ?? [
  'An original instrumental for a two-minute film of an AI patiently playing a classic fantasy adventure game.',
  'Warm medieval-fantasy colour (plucked lute, harp arpeggios, a wooden flute melody, light hand drums and',
  'pizzicato strings) over a relaxed, head-nodding lo-fi hip-hop beat around 92 BPM with soft vinyl texture.',
  'Curious, determined and quietly triumphant, a little playful, never epic and never corporate. A steady,',
  'loopable groove with no big build and no drop, so on-screen text stays readable. Gentle warm ending.',
  'Instrumental only, no vocals. Not based on any existing game theme.',
].join(' ')

const model = process.env.LYRIA_MODEL ?? 'lyria-3.5'
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
})
const body = await res.json()
if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 600)}`)
const parts = body.candidates?.[0]?.content?.parts ?? []
const media = parts.find((p) => p.inlineData)?.inlineData
if (!media) throw new Error(`no audio in the response: ${JSON.stringify(parts.map((p) => p.text ?? Object.keys(p))).slice(0, 400)}`)
const audio = Buffer.from(media.data, 'base64')
writeFileSync(out, audio)
console.log(`${out}  ${media.mimeType}  ${(audio.length / 1e6).toFixed(2)} MB`)
