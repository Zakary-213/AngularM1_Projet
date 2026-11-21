import { peakOf } from './level-meter';

/** Fenêtre d'analyse des vumètres : ~43 ms à 48 kHz, plus longue qu'une image (16 ms), aucune crête n'échappe. */
const METER_FFT_SIZE = 2048;

/** Vumètre stéréo : chaque canal est analysé séparément pour ne pas sous-estimer un son panoramiqué. */
export class StereoMeter {
  private readonly analysers: AnalyserNode[];
  private readonly frame: Float32Array<ArrayBuffer>;

  /** Les nœuds créés sont ajoutés à `nodes`, pour que leur propriétaire puisse les déconnecter. */
  constructor(context: BaseAudioContext, source: AudioNode, nodes: AudioNode[]) {
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    this.analysers = [0, 1].map(channel => {
      const analyser = context.createAnalyser();
      analyser.fftSize = METER_FFT_SIZE;
      splitter.connect(analyser, channel);
      return analyser;
    });
    nodes.push(splitter, ...this.analysers);
    this.frame = new Float32Array(METER_FFT_SIZE);
  }

  peak(): number {
    let peak = 0;
    for (const analyser of this.analysers) {
      analyser.getFloatTimeDomainData(this.frame);
      peak = Math.max(peak, peakOf(this.frame));
    }
    return peak;
  }
}
