# ClearPath — Hardware Integration

## Meta Ray-Ban Smart Glasses

### Specs Relevant to ClearPath

| Feature | Spec | ClearPath Use |
|---------|------|--------------|
| Camera | 12MP, video up to 1080p30 | Stream frames at 5fps to backend |
| Microphone | Dual-mic array | Voice command capture |
| Speakers | Open-ear speakers (both sides) | Audio narration output |
| Connectivity | Bluetooth 5.3, WiFi | BT to phone companion |
| Battery | ~4h continuous, ~8h standby | Sufficient for daily use |
| Weight | 49g | Wearable all day |
| Storage | 32GB internal | Not relevant (no local compute) |

---

## Integration Strategy

Meta does not provide a public SDK for live video streaming from Ray-Ban glasses.
The integration uses a **companion app relay** approach:

```
Ray-Ban Glasses
    │ Bluetooth 5.3
    ▼
iPhone / Android Companion App (Expo React Native)
    │ react-native-ble-plx (BLE)
    │
    ├── Camera frame capture (2 approaches, try in order):
    │   A. Ray-Ban official companion: Use Meta View app's broadcast feature
    │      → Share screen / camera preview to our app via AirPlay/screen capture API
    │   B. Direct BLE: Reverse-engineer BLE GATT characteristics (see notes below)
    │   C. Fallback: Use phone camera (same demo, different input)
    │
    ├── Audio output: expo-av → BT A2DP profile → glasses speakers
    │
    └── Voice commands: BT microphone profile → captured by companion app
                        → sent as audio blob to backend for command parsing
```

### Approach A: Meta View App Integration (Easiest for Hackathon)

The Meta View app on iPhone streams the Ray-Ban camera feed to the phone screen.
We can capture this using iOS's `ReplayKit` framework (screen capture).

```typescript
// apps/mobile/services/bluetooth.ts

import { NativeModules } from 'react-native'

export class RayBanCapture {
  private isCapturing = false

  // iOS: Uses ReplayKit to capture Ray-Ban frame from Meta View app
  async startFrameCapture(onFrame: (jpeg: string) => void): Promise<void> {
    // Use a native module (or expo-camera in external camera mode)
    // that taps into iOS Screen Capture Extension
    // This is the most reliable hackathon approach
    await NativeModules.ScreenCapture.start({
      fps: 5,
      quality: 0.7,      // JPEG quality 0-1
      resolution: '640x480',
      onFrame,
    })
    this.isCapturing = true
  }

  async stopCapture(): Promise<void> {
    await NativeModules.ScreenCapture.stop()
    this.isCapturing = false
  }
}
```

### Approach B: Direct BLE (More Authentic, Riskier)

Ray-Ban Meta glasses use BLE for some communications.
BLE GATT reverse engineering is needed — NOT recommended for hackathon unless time allows.

### Approach C: Phone Camera Fallback (Always Works)

If neither approach works, use the phone camera held at eye level.
The backend pipeline is identical. For demo: hold phone up as if wearing glasses.

```typescript
// apps/mobile/services/camera_relay.ts

import { Camera, CameraType } from 'expo-camera'

export class PhoneCameraRelay {
  private cameraRef: Camera | null = null
  private intervalId: ReturnType<typeof setInterval> | null = null

  async startStreaming(
    wsClient: WebSocketClient,
    fps: number = 5
  ): Promise<void> {
    const interval = Math.floor(1000 / fps)
    this.intervalId = setInterval(async () => {
      if (!this.cameraRef) return
      const photo = await this.cameraRef.takePictureAsync({
        quality: 0.7,
        base64: true,
        skipProcessing: true,  // Faster capture
      })
      wsClient.sendFrame(photo.base64!)
    }, interval)
  }

  stopStreaming(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}
```

---

## Audio Routing

The most reliable path for audio from backend → glasses speakers:

```
Backend (MP3 audio chunk)
    │ WebSocket → Mobile App
    ▼
expo-av Audio Player (phone)
    │ Bluetooth A2DP profile
    ▼
Ray-Ban glasses speakers

FALLBACK (if BT audio unstable):
    Phone speaker (very loud, set to max)
    User holds phone close to ear
    (Less elegant but works for demo)
```

### Audio Queue Implementation

```typescript
// apps/mobile/services/audio.ts

import { Audio } from 'expo-av'

type Priority = 'urgent' | 'normal' | 'low'

interface AudioItem {
  data: string    // base64 MP3
  priority: Priority
  text: string    // For accessibility/display
}

export class AudioQueueManager {
  private queue: AudioItem[] = []
  private playing = false
  private currentSound: Audio.Sound | null = null

  async enqueue(item: AudioItem): Promise<void> {
    if (item.priority === 'urgent') {
      // Immediately stop current audio and play urgent
      await this.stopCurrent()
      this.queue.unshift(item)
    } else if (item.priority === 'low' && this.queue.length > 2) {
      // Drop low priority if queue is backing up
      return
    } else {
      this.queue.push(item)
    }

    if (!this.playing) {
      this.playNext()
    }
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.playing = false
      return
    }

    this.playing = true
    const item = this.queue.shift()!

    // Decode base64 → temp file → play
    const { sound } = await Audio.Sound.createAsync(
      { uri: `data:audio/mp3;base64,${item.data}` },
      { shouldPlay: true }
    )
    this.currentSound = sound

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync()
        this.currentSound = null
        this.playNext()  // Play next in queue
      }
    })
  }

  private async stopCurrent(): Promise<void> {
    if (this.currentSound) {
      await this.currentSound.stopAsync()
      await this.currentSound.unloadAsync()
      this.currentSound = null
    }
    this.playing = false
  }
}
```

---

## WebSocket Client (Mobile → Backend)

```typescript
// apps/mobile/services/websocket.ts

export class ClearPathWebSocketClient {
  private ws: WebSocket | null = null
  private sessionId: string
  private token: string
  private onAudio: (data: string, priority: string, text: string) => void
  private onHazardAlert: (hazard: ProximityAlert) => void
  private reconnectAttempts = 0

  constructor(config: {
    sessionId: string
    token: string
    backendWsUrl: string
    onAudio: (data: string, priority: string, text: string) => void
    onHazardAlert: (hazard: ProximityAlert) => void
  }) {
    this.sessionId = config.sessionId
    this.token = config.token
    this.onAudio = config.onAudio
    this.onHazardAlert = config.onHazardAlert
    this.connect(config.backendWsUrl)
  }

  private connect(wsUrl: string): void {
    this.ws = new WebSocket(
      `${wsUrl}/ws/${this.sessionId}`,
      undefined,
      { headers: { Authorization: `Bearer ${this.token}` } }
    )

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'audio':
          this.onAudio(msg.data, msg.priority, msg.text)
          break
        case 'hazard_alert':
          this.onHazardAlert(msg.hazard)
          break
        case 'pong':
          break
      }
    }

    this.ws.onclose = () => {
      // Exponential backoff reconnect
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)
      setTimeout(() => {
        this.reconnectAttempts++
        this.connect(wsUrl)
      }, delay)
    }

    // Keepalive ping every 30s
    setInterval(() => {
      this.ws?.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
    }, 30000)
  }

  sendFrame(base64: string, gps?: { lat: number; lng: number }): void {
    this.ws?.send(JSON.stringify({
      type: 'frame',
      data: base64,
      timestamp: Date.now(),
      gps,
    }))
  }

  sendCommand(command: string): void {
    this.ws?.send(JSON.stringify({
      type: 'command',
      command,
      timestamp: Date.now(),
    }))
  }
}
```

---

## Demo Setup Checklist

```
Hardware preparation:
□ Meta Ray-Ban glasses charged (≥ 80%)
□ Meta View app installed and paired on demo phone
□ ClearPath companion app installed and tested
□ Phone WiFi connected (same network as backend, or hotspot for Modal)

Audio test:
□ Audio from backend plays through glasses speakers (test: play a narration)
□ Backup: AirPods/headphones connected and tested
□ Final backup: Phone speaker (loud)

Camera test:
□ Glasses camera → phone capture working
□ Test frame at: curl -X POST /health to confirm backend live
□ Do a full end-to-end walk test 30min before demo

Fallback mode:
□ Phone camera relay mode tested and working
□ Demo script rehearsed with phone camera fallback
```

---

## Why This Is "Best Use of Hardware"

**Judges want to see AI meaningfully integrated with physical hardware.**

ClearPath scores on this by:
1. **Primary input:** Ray-Ban camera (12MP optical sensor) — real hardware, not a web camera
2. **Primary output:** Ray-Ban speakers (directional audio) — hardware audio output
3. **Form factor matters:** Glasses = hands-free = essential for blindness use case. A phone on a desk doesn't work. The glasses form factor *is* the innovation.
4. **Hardware-AI coupling:** The AI narration is only useful because the glasses keep the user's hands free. Remove the hardware, the product stops working entirely.
5. **Simulation fallback:** Per the track rules, "you don't need physical hardware if you can simulate it." Even with phone camera as demo, the integration strategy with Ray-Bans is clearly articulated.

**Key line for judges:** "This isn't just a computer vision demo. It's a wearable AI guide dog. The hardware form factor — glasses you forget you're wearing — is what makes hands-free navigation for the blind actually possible."
