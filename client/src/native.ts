// The bridge the desktop shell exposes. Undefined in a plain browser tab.
export type Source = { id: string; name: string; thumb: string; kind: 'screen' | 'window' };
export type RawActivity = { state: 'away' | 'desk' | 'gaming' | 'watching'; label: string; proc: string; /** The PC is locked (apps from 0.1.4 on say so). */ locked?: boolean };
export type DesktopConfig = { autoLaunch: boolean; closeToTray: boolean; games: string[] };
export type NativeApi = {
  version: string;
  platform: string;
  getSources(): Promise<Source[]>;
  /** Arms the next screen capture with the source the person picked. */
  selectSource(id: string, audio: boolean): Promise<void>;
  onActivity(cb: (a: RawActivity) => void): void;
  /** How long the mouse and keyboard may sit untouched at the desk before the app says "away" (0.1.7 on; before that it
   *  was always five minutes, a game or a video in front or not). */
  setAwayAfter?(seconds: number): void;
  setHotkeys(map: Record<string, string>): Promise<Record<string, boolean>>;
  onHotkey(cb: (action: string) => void): void;
  getConfig(): Promise<DesktopConfig>;
  setConfig(c: Partial<DesktopConfig>): Promise<DesktopConfig>;
  /** `deafened` (0.1.5 on): the app mutes its whole window while it is true. */
  setTray(s: { muted: boolean; inVoice: boolean; unread: boolean; deafened?: boolean }): void;
  forgetServer(): void;
  /** The app draws its own title bar, so it needs to ask for these. */
  windowControl?(what: 'minimize' | 'maximize' | 'close' | 'expand' | `compact:${number}`): void;
  /** Told whenever the window is closed to the tray or brought back. */
  onWindow?(cb: (visible: boolean) => void): void;
  /** A small notice at the bottom right of the screen, shown while the window is closed or behind something. */
  popup?(text: string, accent: string): void;
  /** How many people are online, for the little counter that stays up while the window is closed. */
  setOnline?(count: number, accent: string): void;
  /** Fetches the newest installer from the server and hands over to it. The app closes and comes back by itself. (0.1.3 on.) */
  installUpdate?(): Promise<{ error?: string; dry?: boolean; version?: string }>;
  onUpdate?(cb: (p: { state: string; part: number }) => void): void;
  /** The sound of one shared window's program (0.1.6 on), as 16-bit stereo at 48 kHz in pieces; null when it has stopped.
   *  `sourceId` is the window picked for sharing. A whole screen has no sound: see voice.ts. */
  startShareSound?(sourceId: string): Promise<{ error?: string }>;
  stopShareSound?(): void;
  onShareSound?(cb: (chunk: Uint8Array | null) => void): void;
  /** The app captures the screen or window itself (0.2.1 on; see desktop/main.cjs), which holds 60 pictures a second where
   *  the browser's own capture cannot. `side`: the most dots along the picture's shorter side. Its H.264 follows on a
   *  channel posted to the page's window ({ chatterdayShareVideo: true }, with the port). An error means: capture it the old way. */
  startShareVideo?(sourceId: string, want: { side: number; fps: number }): Promise<{ error?: string; width?: number; height?: number; fps?: number; encoder?: string }>;
  stopShareVideo?(): void;
  /** Nobody needs the pictures for now (true), or somebody does again (false): the app captures two a second meanwhile
   *  instead of sixty (0.2.3 on). The stream starts afresh each time, after a { restart: true, fps } on the channel. */
  setShareVideoIdle?(idle: boolean): void;
};
export const native: NativeApi | undefined = (window as any).chatterdayNative;
