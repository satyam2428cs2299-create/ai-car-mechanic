import { MediaAttachment, VehicleProfile } from '../types/mechanic';

export interface DiagnosticPreset {
  id: string;
  title: string;
  shortDescription: string;
  category: 'Brakes' | 'Engine' | 'Electrical' | 'Cooling' | 'Transmission' | 'Off-Topic Test';
  initialUserMessage: string;
  vehicle: VehicleProfile;
  sampleMedia?: MediaAttachment[];
  tags: string[];
}

export const SAMPLE_PRESETS: DiagnosticPreset[] = [
  {
    id: 'brake-squeal',
    title: 'High-Pitched Brake Squeal & Scraping',
    shortDescription: 'Squeals when slowing down at low speeds; audible grinding.',
    category: 'Brakes',
    vehicle: {
      year: '2019',
      make: 'Honda',
      model: 'Civic EX',
      mileage: '48,500',
      engine: '2.0L 4-Cyl',
    },
    initialUserMessage:
      'My car started making a sharp, high-pitched metallic squealing sound every time I lightly press the brake pedal when coming to a red light. It feels a bit rough under the pedal.',
    sampleMedia: [
      {
        id: 'media-brake-1',
        type: 'image',
        fileName: 'front_brake_rotor_scoring.jpg',
        fileSize: 420000,
        mimeType: 'image/jpeg',
        url: 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80',
        description: 'Photo showing front brake disc rotor with visible scoring and thin friction pad',
      },
      {
        id: 'media-brake-audio',
        type: 'audio',
        fileName: 'brake_squeak_audio.mp3',
        fileSize: 180000,
        mimeType: 'audio/mpeg',
        duration: 8,
        url: 'https://assets.mixkit.co/active_storage/sfx/2874/2874-preview.mp3',
        description: 'Recorded audio clip of metallic brake squeal during deceleration',
      },
    ],
    tags: ['Brakes', 'Squeal', 'Rotor wear'],
  },
  {
    id: 'engine-knock-tick',
    title: 'Engine Ticking & Tapping at Idle',
    shortDescription: 'Rhythmic metallic ticking noise that speeds up with revs.',
    category: 'Engine',
    vehicle: {
      year: '2016',
      make: 'Ford',
      model: 'F-150 XLT',
      mileage: '94,200',
      engine: '5.0L V8 Coyote',
    },
    initialUserMessage:
      'I hear a rhythmic clicking/tapping sound coming from under the hood when the truck is idling. When I gently rev the engine, the ticking sound speeds up directly with the RPM.',
    sampleMedia: [
      {
        id: 'media-engine-1',
        type: 'image',
        fileName: 'engine_bay_valve_cover.jpg',
        fileSize: 580000,
        mimeType: 'image/jpeg',
        url: '/engine-components.svg',
        description: 'Engine bay photo highlighting valve train / cylinder head area',
      },
      {
        id: 'media-engine-audio',
        type: 'audio',
        fileName: 'engine_lifter_tick.mp3',
        fileSize: 220000,
        mimeType: 'audio/mpeg',
        duration: 12,
        url: 'https://assets.mixkit.co/active_storage/sfx/1705/1705-preview.mp3',
        description: 'Audio recording capturing rhythmic valvetrain / lifter tick at idle',
      },
    ],
    tags: ['Engine', 'Lifter Tick', 'Oil Pressure'],
  },
  {
    id: 'check-engine-flashing',
    title: 'Flashing Check Engine Light & Violent Shaking',
    shortDescription: 'Loss of acceleration, rough idle, CEL is blinking.',
    category: 'Engine',
    vehicle: {
      year: '2018',
      make: 'Toyota',
      model: 'RAV4 LE',
      mileage: '72,100',
      engine: '2.5L 4-Cylinder',
    },
    initialUserMessage:
      'My check engine light just started FLASHING while driving on the highway! The whole car is shuddering and shaking violently when I step on the gas, and I smell unburned gas.',
    sampleMedia: [
      {
        id: 'media-cel-dash',
        type: 'image',
        fileName: 'dashboard_flashing_cel.jpg',
        fileSize: 310000,
        mimeType: 'image/jpeg',
        url: 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=800&q=80',
        description: 'Dashboard instrument cluster showing blinking MIL / Check Engine light',
      },
    ],
    tags: ['Critical', 'Misfire P0300', 'Ignition Coil'],
  },
  {
    id: 'overheating-steam',
    title: 'Coolant Leak & Rising Temperature Gauge',
    shortDescription: 'Sweet smell from vents, temp needle creeping into the red.',
    category: 'Cooling',
    vehicle: {
      year: '2015',
      make: 'Subaru',
      model: 'Outback 2.5i',
      mileage: '112,000',
      engine: '2.5L Boxer',
    },
    initialUserMessage:
      'I noticed a maple syrup sweet smell after stopping. The temperature gauge needle spiked near the red H mark, and there was a bit of vapor coming from under the grill.',
    sampleMedia: [
      {
        id: 'media-coolant-leak',
        type: 'image',
        fileName: 'coolant_under_radiator.jpg',
        fileSize: 490000,
        mimeType: 'image/jpeg',
        url: 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80',
        description: 'Greenish-blue coolant residue pooling near bottom radiator hose',
      },
    ],
    tags: ['Overheating', 'Radiator', 'Coolant'],
  },
  {
    id: 'off-topic-test',
    title: 'Off-Topic Prompt (Testing Boundary Policy)',
    shortDescription: 'Tests the strict automotive domain filter and polite rejection.',
    category: 'Off-Topic Test',
    vehicle: {
      year: '2021',
      make: 'Tesla',
      model: 'Model 3',
      mileage: '30,000',
      engine: 'Dual Motor EV',
    },
    initialUserMessage:
      'Can you write me a poem about cherry blossoms in Kyoto and give me a recipe for chocolate fudge brownies?',
    tags: ['Scope Test', 'Guardrail'],
  },
];
