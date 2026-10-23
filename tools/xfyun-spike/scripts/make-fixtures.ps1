<#
.SYNOPSIS
  Regenerates the synthetic test audio in ../fixtures (16 kHz / 16 bit / mono raw PCM).

.DESCRIPTION
  Uses the Windows SAPI synthesizer (System.Speech) — no recordings of real people.
  Only en-US voices ship with stock Windows; Chinese fixtures need a zh-CN voice
  (e.g. "Microsoft Huihui") or another TTS engine. The mock server ignores audio
  content, so English clips are enough for the offline checks. For the real-key
  round (T-003 stage 2) also synthesize Chinese phrases from docs/seed/command-lexicon.v1.json.
#>
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\fixtures')
)

Add-Type -AssemblyName System.Speech
$phrases = @{
  'en-stop'           = 'Stop.'
  'en-follow-me'      = 'Follow me.'
  'en-return-to-base' = 'Return to base.'
  'en-start-patrol'   = 'Start patrol.'
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($name in $phrases.Keys) {
  $wav = Join-Path $OutDir "$name.wav"
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('Microsoft David Desktop')
  $synth.SetOutputToWaveFile($wav, $format)
  $synth.Speak($phrases[$name])
  $synth.Dispose()

  # Strip the 44-byte RIFF header -> raw PCM the clients stream directly.
  $bytes = [System.IO.File]::ReadAllBytes($wav)
  [System.IO.File]::WriteAllBytes((Join-Path $OutDir "$name.pcm"), $bytes[44..($bytes.Length - 1)])
  [System.IO.File]::Delete($wav)
}
Get-ChildItem $OutDir -Filter *.pcm | Select-Object Name, Length
