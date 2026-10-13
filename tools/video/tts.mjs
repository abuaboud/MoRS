// Voiceover lines with Gemini TTS. Each line becomes <outDir>/<id>.wav, and durations go to <outDir>/lines.json.
// usage: GEMINI_API_KEY=... node tools/video/tts.mjs <lines.json> <outDir>
//   lines.json: {"voice": "Charon", "model"?: "gemini-3.8-flash-tts", "lines": [{"id": "l1", "text": "…"}]}
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const [spec, out] = process.argv.slice(2)
const key = process.env.GEMINI_API_KEY
if (!spec || !out || !key) throw new Error('usage: GEMINI_API_KEY=... node tools/video/tts.mjs <lines.json> <outDir>')
// no style prompt: the TTS models read any direction aloud and reject a system instruction; pick the voice instead
const { voice = 'Charon', model = 'gemini-3.8-flash-tts', lines } = JSON.parse(readFileSync(spec, 'utf8'))
mkdirSync(out, { recursive: true })

async function say(text, attempt = 0) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  })
  const body = await res.json()
  if (res.status === 429 && attempt < 8) { // 10 requests a minute per model: wait and retry
    await new Promise((r) => setTimeout(r, 15000))
    return say(text, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`)
  const media = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!media?.data) throw new Error(`no audio for: ${text}`)
  // newer models send a whole WAV file (header + data + a C2PA provenance chunk); older ones send raw 24 kHz PCM.
  // Decoding the WAV as raw PCM turns the header into a click and the C2PA chunk into a burst of noise.
  return { audio: Buffer.from(media.data, 'base64'), wav: /wav/.test(media.mimeType ?? '') }
}

const result = []
for (const l of lines) { // one at a time, saved as we go, so a rate limit or crash never loses finished lines
  const { audio, wav } = await say(l.text)
  const raw = `${out}/${l.id}.${wav ? 'in.wav' : 'pcm'}`
  writeFileSync(raw, audio)
  // trim the silence TTS leaves at both ends, so lines can be placed to the frame
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...(wav ? [] : ['-f', 's16le', '-ar', '24000', '-ac', '1']), '-i', raw,
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
    '-ar', '48000', `${out}/${l.id}.wav`])
  unlinkSync(raw)
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${out}/${l.id}.wav`]))
  result.push({ ...l, dur: Math.round(dur * 1000) / 1000 })
  writeFileSync(`${out}/lines.json`, JSON.stringify(result, null, 1))
}
for (const l of result) console.log(`${l.id}  ${l.dur.toFixed(2)}s  ${l.text}`)
