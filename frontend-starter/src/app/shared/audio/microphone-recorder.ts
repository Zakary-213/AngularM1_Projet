/**
 * Capture micro d'une prise vocale, séparée de la prod : le micro n'enregistre
 * que l'entrée, jamais le mix du navigateur. Pour éviter que la prod soit captée
 * par le micro (et le larsen), l'écoute se fait au casque ; aucun retour micro
 * n'est envoyé aux haut-parleurs.
 */

/** Formats essayés dans l'ordre : Opus est compact et lu par Chrome, Firefox et Edge ; MP4 pour Safari. */
export const RECORDING_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickRecordingMimeType(isSupported: (mimeType: string) => boolean): string | null {
  return RECORDING_MIME_CANDIDATES.find(isSupported) ?? null;
}

export function describeMicrophoneError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Accès au micro refusé. Autorisez-le dans les réglages du site puis réessayez.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucun micro détecté. Branchez un micro puis réessayez.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Le micro est indisponible (peut-être utilisé par une autre application).';
    default:
      return "Impossible de démarrer l'enregistrement.";
  }
}

/**
 * Position de la prise dans le morceau, en secondes. Le chanteur entend la prod
 * avec la latence de sortie, et sa voix atteint l'enregistreur avec la latence
 * d'entrée : on recule la prise de la somme des deux. Les valeurs fournies par
 * le navigateur sont des estimations ; une mesure par boucle sera nécessaire en M8.
 */
export function takeStartSeconds(recorderStartTime: number, songStartTime: number, roundTripLatencySeconds: number): number {
  return recorderStartTime - songStartTime - roundTripLatencySeconds;
}

/** Entrée audio proposée dans la liste « Micro ». */
export interface InputDevice {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * Entrées audio disponibles. Les noms ne sont fournis par le navigateur qu'après
 * une autorisation du micro : avant, un nom générique est affiché.
 */
export function toInputDevices(devices: readonly MediaDeviceInfo[]): InputDevice[] {
  return devices
    .filter(device => device.kind === 'audioinput' && device.deviceId !== '')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Micro ${index + 1}` }));
}

/** Type MIME sans paramètres et extension de fichier, pour l'envoi d'une prise au serveur. */
export function recordingFileFormat(mimeType: string): { type: string; extension: string } {
  const type = mimeType.split(';')[0].trim().toLowerCase();
  const extension = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : type === 'audio/wav' ? 'wav' : 'webm';
  return { type, extension };
}

export interface RecordedTake {
  readonly blob: Blob;
  readonly mimeType: string;
  /** Latence d'entrée annoncée par le navigateur, en secondes (0 si inconnue). */
  readonly inputLatencySeconds: number;
}

export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Flux du micro ouvert, pour l'indicateur de niveau (jamais envoyé aux haut-parleurs). */
  get inputStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Demande l'accès au micro. À appeler uniquement depuis l'action « Enregistrer ».
   * `deviceId` : entrée choisie dans la liste ; absente, l'entrée par défaut du système.
   */
  async open(deviceId?: string | null): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error("Ce navigateur ne permet pas d'enregistrer le micro.");
    }
    const mimeType = pickRecordingMimeType(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      throw new Error("Aucun format d'enregistrement audio n'est pris en charge par ce navigateur.");
    }
    this.release();
    // Traitements « visio » désactivés : ils dégradent une voix chantée ou rappée.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    this.recorder = new MediaRecorder(this.stream, { mimeType });
  }

  /**
   * Démarre l'enregistrement sur le micro ouvert. `onStarted` est appelé quand
   * l'enregistreur commence réellement, pour dater la prise sur l'horloge audio.
   */
  record(onStarted: () => void): void {
    const recorder = this.recorder;
    if (!recorder) {
      throw new Error("Le micro n'est pas ouvert.");
    }
    this.chunks = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    recorder.onstart = onStarted;
    recorder.start();
  }

  stop(): Promise<RecordedTake> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new Error('Aucun enregistrement en cours.'));
    }
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType;
        const blob = new Blob(this.chunks, { type: mimeType });
        this.release();
        if (blob.size === 0) {
          reject(new Error("La prise est vide : aucun son n'a été reçu du micro."));
          return;
        }
        resolve({ blob, mimeType, inputLatencySeconds: typeof settings?.latency === 'number' ? settings.latency : 0 });
      };
      recorder.stop();
    });
  }

  /** Coupe le micro (le témoin du navigateur s'éteint). Sans effet si rien n'est ouvert. */
  release(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
