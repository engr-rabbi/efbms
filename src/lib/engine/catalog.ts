// =============================================================================
// Engine: Catalogs & Default Design Rules
// All default loads, diameters and allowances are CONFIGURABLE via DesignRule.
// =============================================================================

export interface PointTypeMeta {
  type: string
  labelEn: string
  labelBn: string
  defaultLoadW: number
  circuitGroup: 'LIGHT' | 'SOCKET' | 'DEDICATED' | 'NONE'
  dedicatedCircuit?: string // for DEDICATED group: AC | GEYSER | KITCHEN | WASHER
  icon: string
}

export const POINT_TYPES: PointTypeMeta[] = [
  { type: 'LIGHT', labelEn: 'Light Point', labelBn: 'লাইট পয়েন্ট', defaultLoadW: 25, circuitGroup: 'LIGHT', icon: 'Lightbulb' },
  { type: 'CEILING_FAN', labelEn: 'Ceiling Fan Point', labelBn: 'সিলিং ফ্যান পয়েন্ট', defaultLoadW: 75, circuitGroup: 'LIGHT', icon: 'Fan' },
  { type: 'EXHAUST_FAN', labelEn: 'Exhaust Fan Point', labelBn: 'এক্সহস্ট ফ্যান পয়েন্ট', defaultLoadW: 60, circuitGroup: 'LIGHT', icon: 'Fan' },
  { type: 'SWITCHBOARD', labelEn: 'Switchboard', labelBn: 'সুইচবোর্ড', defaultLoadW: 0, circuitGroup: 'NONE', icon: 'PanelTop' },
  { type: 'SOCKET', labelEn: 'General Socket (6A)', labelBn: 'জেনারেল সকেট (৬A)', defaultLoadW: 200, circuitGroup: 'SOCKET', icon: 'Plug' },
  { type: 'AC', labelEn: 'AC Point (1.5 Ton)', labelBn: 'এসি পয়েন্ট (১.৫ টন)', defaultLoadW: 1800, circuitGroup: 'DEDICATED', dedicatedCircuit: 'AC', icon: 'AirVent' },
  { type: 'FRIDGE', labelEn: 'Refrigerator Point', labelBn: 'ফ্রিজ পয়েন্ট', defaultLoadW: 300, circuitGroup: 'SOCKET', icon: 'Refrigerator' },
  { type: 'WASHING_MACHINE', labelEn: 'Washing Machine Point', labelBn: 'ওয়াশিং মেশিন পয়েন্ট', defaultLoadW: 500, circuitGroup: 'DEDICATED', dedicatedCircuit: 'WASHER', icon: 'WashingMachine' },
  { type: 'GEYSER', labelEn: 'Geyser / Water Heater Point', labelBn: 'গিজার পয়েন্ট', defaultLoadW: 1500, circuitGroup: 'DEDICATED', dedicatedCircuit: 'GEYSER', icon: 'Flame' },
  { type: 'KITCHEN_APPLIANCE', labelEn: 'Kitchen Appliance Point (16A)', labelBn: 'কিচেন অ্যাপ্লায়েন্স পয়েন্ট', defaultLoadW: 1500, circuitGroup: 'DEDICATED', dedicatedCircuit: 'KITCHEN', icon: 'CookingPot' },
  { type: 'TV_DATA', labelEn: 'TV / Data / Router Point', labelBn: 'টিভি/ডাটা/রাউটার পয়েন্ট', defaultLoadW: 50, circuitGroup: 'SOCKET', icon: 'Wifi' },
  { type: 'EMERGENCY_LIGHT', labelEn: 'Emergency Light', labelBn: 'ইমার্জেন্সি লাইট', defaultLoadW: 10, circuitGroup: 'LIGHT', icon: 'Flashlight' },
  { type: 'OUTDOOR_LIGHT', labelEn: 'Outdoor / Security Light', labelBn: 'আউটডোর/সিকিউরিটি লাইট', defaultLoadW: 60, circuitGroup: 'LIGHT', icon: 'Lamp' },
  { type: 'DEDICATED', labelEn: 'Other Dedicated Load Point', labelBn: 'অন্যান্য ডেডিকেটেড লোড পয়েন্ট', defaultLoadW: 1000, circuitGroup: 'DEDICATED', dedicatedCircuit: 'DEDICATED', icon: 'Zap' },
]

export interface FixtureTypeMeta {
  type: string
  labelEn: string
  labelBn: string
  coldDia: string
  hotDia: string
  wasteDia: string
  soilDia: string
  coldAllowM: number // horizontal branch allowance (m)
  hotAllowM: number
  wasteAllowM: number
  soilAllowM: number
  wetArea: boolean
  icon: string
}

export const FIXTURE_TYPES: FixtureTypeMeta[] = [
  { type: 'WC', labelEn: 'Water Closet / Commode', labelBn: 'ওয়াটার ক্লোজেট/কমোড', coldDia: '15', hotDia: '', wasteDia: '', soilDia: '110', coldAllowM: 4, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 2.5, wetArea: true, icon: 'Bath' },
  { type: 'BASIN', labelEn: 'Wash Basin', labelBn: 'ওয়াশ বেসিন', coldDia: '15', hotDia: '15', wasteDia: '32', soilDia: '', coldAllowM: 3, hotAllowM: 3, wasteAllowM: 2, soilAllowM: 0, wetArea: true, icon: 'Droplet' },
  { type: 'SINK', labelEn: 'Kitchen Sink', labelBn: 'কিচেন সিঙ্ক', coldDia: '15', hotDia: '15', wasteDia: '40', soilDia: '', coldAllowM: 4, hotAllowM: 4, wasteAllowM: 2.5, soilAllowM: 0, wetArea: true, icon: 'UtensilsCrossed' },
  { type: 'SHOWER', labelEn: 'Shower', labelBn: 'শাওয়ার', coldDia: '15', hotDia: '15', wasteDia: '50', soilDia: '', coldAllowM: 3.5, hotAllowM: 3.5, wasteAllowM: 2, soilAllowM: 0, wetArea: true, icon: 'ShowerHead' },
  { type: 'BIB_COCK', labelEn: 'Faucet / Bib Cock', labelBn: 'ফসেট/বিব কক', coldDia: '15', hotDia: '', wasteDia: '', soilDia: '', coldAllowM: 3, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 0, wetArea: false, icon: 'Droplets' },
  { type: 'FLOOR_DRAIN', labelEn: 'Floor Drain', labelBn: 'ফ্লোর ড্রেইন', coldDia: '', hotDia: '', wasteDia: '50', soilDia: '', coldAllowM: 0, hotAllowM: 0, wasteAllowM: 1.5, soilAllowM: 0, wetArea: true, icon: 'CircleDot' },
  { type: 'FLOOR_TRAP', labelEn: 'Floor Trap', labelBn: 'ফ্লোর ট্র্যাপ', coldDia: '', hotDia: '', wasteDia: '50', soilDia: '', coldAllowM: 0, hotAllowM: 0, wasteAllowM: 0.5, soilAllowM: 0, wetArea: true, icon: 'CircleDashed' },
  { type: 'WASHING_MACHINE', labelEn: 'Washing Machine Point', labelBn: 'ওয়াশিং মেশিন পয়েন্ট', coldDia: '15', hotDia: '', wasteDia: '50', soilDia: '', coldAllowM: 3, hotAllowM: 0, wasteAllowM: 2, soilAllowM: 0, wetArea: false, icon: 'WashingMachine' },
  { type: 'GEYSER', labelEn: 'Geyser Connection', labelBn: 'গিজার কানেকশন', coldDia: '15', hotDia: '15', wasteDia: '', soilDia: '', coldAllowM: 2, hotAllowM: 2, wasteAllowM: 0, soilAllowM: 0, wetArea: true, icon: 'Flame' },
  { type: 'PURIFIER', labelEn: 'Water Purifier Connection', labelBn: 'পানি পিউরিফায়ার কানেকশন', coldDia: '15', hotDia: '', wasteDia: '', soilDia: '', coldAllowM: 1.5, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 0, wetArea: false, icon: 'Filter' },
  { type: 'TANK_CONNECTION', labelEn: 'Water Tank Connection', labelBn: 'পানির ট্যাংক কানেকশন', coldDia: '25', hotDia: '', wasteDia: '', soilDia: '', coldAllowM: 6, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 0, wetArea: false, icon: 'Database' },
  { type: 'PUMP_CONNECTION', labelEn: 'Pump Connection', labelBn: 'পাম্প কানেকশন', coldDia: '25', hotDia: '', wasteDia: '', soilDia: '', coldAllowM: 5, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 0, wetArea: false, icon: 'Cog' },
  { type: 'RAINWATER_OUTLET', labelEn: 'Rainwater Outlet', labelBn: 'বৃষ্টির পানির আউটলেট', coldDia: '', hotDia: '', wasteDia: '', soilDia: '75', coldAllowM: 0, hotAllowM: 0, wasteAllowM: 0, soilAllowM: 3, wetArea: false, icon: 'CloudRain' },
  { type: 'OTHER', labelEn: 'Other Plumbing Fixture', labelBn: 'অন্যান্য প্লাম্বিং ফিক্সচার', coldDia: '15', hotDia: '', wasteDia: '40', soilDia: '', coldAllowM: 3, hotAllowM: 0, wasteAllowM: 2, soilAllowM: 0, wetArea: false, icon: 'Wrench' },
]

export const ROOM_TYPES = [
  { type: 'BEDROOM', labelEn: 'Bedroom', labelBn: 'শোবার ঘর' },
  { type: 'LIVING', labelEn: 'Living Room', labelBn: 'বসার ঘর' },
  { type: 'DINING', labelEn: 'Dining Room', labelBn: 'ডাইনিং রুম' },
  { type: 'KITCHEN', labelEn: 'Kitchen', labelBn: 'রান্নাঘর' },
  { type: 'BATHROOM', labelEn: 'Bathroom', labelBn: 'বাথরুম' },
  { type: 'BALCONY', labelEn: 'Balcony', labelBn: 'বারান্দা' },
  { type: 'CORRIDOR', labelEn: 'Corridor', labelBn: 'করিডোর' },
  { type: 'STAIRCASE', labelEn: 'Staircase', labelBn: 'সিঁড়ি' },
  { type: 'GARAGE', labelEn: 'Garage', labelBn: 'গ্যারেজ' },
  { type: 'ROOF', labelEn: 'Roof', labelBn: 'ছাদ' },
  { type: 'STORE', labelEn: 'Store', labelBn: 'স্টোর' },
  { type: 'OTHER', labelEn: 'Other', labelBn: 'অন্যান্য' },
]

export interface DesignRules {
  // electrical
  lightCircuitMaxPoints: number
  lightBreakerA: number
  socketCircuitMaxPoints: number
  socketBreakerA: number
  acBreakerA: number
  geyserBreakerA: number
  kitchenBreakerA: number
  washerBreakerA: number
  demandFactor: number
  powerFactor: number
  voltage: number
  maxVdPct: number
  wireWastagePct: number
  conduitWastagePct: number
  accessoryWastagePct: number
  pipeWastagePct: number
  fittingWastagePct: number
  coilLengthM: number
  lightWire: string
  socketWire: string
  acWire: string
  geyserWire: string
  kitchenWire: string
  avgHorizontalToDbM: number
  dbPerFloor: boolean
  rccbRating: string
  spdPerBuilding: number
  mainFeederAssumedM: number
  ceilingDropM: number
  switchDropM: number
  socketDropM: number
  // plumbing
  perCapitaLpd: number
  occupantsPerFloor: number
  ohtFactor: number
  ugtFactor: number
  pumpHours: number
  rainDownpipes: number
  coldRiserPerFloor: number
  hotRiserPerFloor: number
  pprStickM: number
  pvcStickM: number
  clampPerM: number
}

export const DEFAULT_RULES: DesignRules = {
  lightCircuitMaxPoints: 10,
  lightBreakerA: 10,
  socketCircuitMaxPoints: 6,
  socketBreakerA: 16,
  acBreakerA: 20,
  geyserBreakerA: 16,
  kitchenBreakerA: 20,
  washerBreakerA: 16,
  demandFactor: 0.7,
  powerFactor: 0.9,
  voltage: 230,
  maxVdPct: 4,
  wireWastagePct: 8,
  conduitWastagePct: 10,
  accessoryWastagePct: 5,
  pipeWastagePct: 8,
  fittingWastagePct: 5,
  coilLengthM: 91.4,
  lightWire: '1.5',
  socketWire: '2.5',
  acWire: '4.0',
  geyserWire: '2.5',
  kitchenWire: '4.0',
  avgHorizontalToDbM: 10,
  dbPerFloor: true,
  rccbRating: '40A-30mA',
  spdPerBuilding: 1,
  mainFeederAssumedM: 15,
  ceilingDropM: 2.6,
  switchDropM: 2.0,
  socketDropM: 2.0,
  perCapitaLpd: 135,
  occupantsPerFloor: 6,
  ohtFactor: 0.5,
  ugtFactor: 1.0,
  pumpHours: 6,
  rainDownpipes: 4,
  coldRiserPerFloor: 8,
  hotRiserPerFloor: 6,
  pprStickM: 4,
  pvcStickM: 3,
  clampPerM: 1.5,
}

export const RULE_LABELS: Record<keyof DesignRules, { en: string; bn: string }> = {
  lightCircuitMaxPoints: { en: 'Max points per light circuit', bn: 'লাইট সার্কিটে সর্বোচ্চ পয়েন্ট' },
  lightBreakerA: { en: 'Light circuit breaker (A)', bn: 'লাইট সার্কিট ব্রেকার (A)' },
  socketCircuitMaxPoints: { en: 'Max points per socket circuit', bn: 'সকেট সার্কিটে সর্বোচ্চ পয়েন্ট' },
  socketBreakerA: { en: 'Socket circuit breaker (A)', bn: 'সকেট সার্কিট ব্রেকার (A)' },
  acBreakerA: { en: 'AC dedicated breaker (A)', bn: 'এসি ডেডিকেটেড ব্রেকার (A)' },
  geyserBreakerA: { en: 'Geyser breaker (A)', bn: 'গিজার ব্রেকার (A)' },
  kitchenBreakerA: { en: 'Kitchen circuit breaker (A)', bn: 'কিচেন সার্কিট ব্রেকার (A)' },
  washerBreakerA: { en: 'Washing machine breaker (A)', bn: 'ওয়াশিং মেশিন ব্রেকার (A)' },
  demandFactor: { en: 'Demand factor', bn: 'ডিমান্ড ফ্যাক্টর' },
  powerFactor: { en: 'Power factor', bn: 'পাওয়ার ফ্যাক্টর' },
  voltage: { en: 'System voltage (V)', bn: 'সিস্টেম ভোল্টেজ (V)' },
  maxVdPct: { en: 'Max voltage drop (%)', bn: 'সর্বোচ্চ ভোল্টেজ ড্রপ (%)' },
  wireWastagePct: { en: 'Wire wastage (%)', bn: 'ওয়্যার অপচয় (%)' },
  conduitWastagePct: { en: 'Conduit wastage (%)', bn: 'কনডুইট অপচয় (%)' },
  accessoryWastagePct: { en: 'Accessory wastage (%)', bn: 'অ্যাক্সেসরিজ অপচয় (%)' },
  pipeWastagePct: { en: 'Pipe wastage (%)', bn: 'পাইপ অপচয় (%)' },
  fittingWastagePct: { en: 'Fitting wastage (%)', bn: 'ফিটিং অপচয় (%)' },
  coilLengthM: { en: 'Standard wire coil length (m)', bn: 'স্ট্যান্ডার্ড ওয়্যার কয়েল (মি)' },
  lightWire: { en: 'Light circuit wire size (sqmm)', bn: 'লাইট সার্কিট ওয়্যার (sqmm)' },
  socketWire: { en: 'Socket circuit wire size (sqmm)', bn: 'সকেট সার্কিট ওয়্যার (sqmm)' },
  acWire: { en: 'AC circuit wire size (sqmm)', bn: 'এসি সার্কিট ওয়্যার (sqmm)' },
  geyserWire: { en: 'Geyser wire size (sqmm)', bn: 'গিজার ওয়্যার (sqmm)' },
  kitchenWire: { en: 'Kitchen circuit wire size (sqmm)', bn: 'কিচেন সার্কিট ওয়্যার (sqmm)' },
  avgHorizontalToDbM: { en: 'Avg horizontal distance to DB (m)', bn: 'রুম থেকে DB গড় দূরত্ব (মি)' },
  dbPerFloor: { en: 'One DB per floor', bn: 'প্রতি তলায় একটি DB' },
  rccbRating: { en: 'RCCB rating', bn: 'RCCB রেটিং' },
  spdPerBuilding: { en: 'SPD quantity per building', bn: 'প্রতি ভবনে SPD সংখ্যা' },
  mainFeederAssumedM: { en: 'Main feeder assumed length (m)', bn: 'মেইন ফিডার আনুমানিক দৈর্ঘ্য (মি)' },
  ceilingDropM: { en: 'Ceiling point drop allowance (m)', bn: 'সিলিং পয়েন্ট ড্রপ (মি)' },
  switchDropM: { en: 'Switch drop allowance (m)', bn: 'সুইচ ড্রপ (মি)' },
  socketDropM: { en: 'Socket drop allowance (m)', bn: 'সকেট ড্রপ (মি)' },
  perCapitaLpd: { en: 'Water demand per person (L/day)', bn: 'জনপ্রতি পানির চাহিদা (লি/দিন)' },
  occupantsPerFloor: { en: 'Default occupants per floor', bn: 'প্রতি তলায় ডিফল্ট ব্যবহারকারী' },
  ohtFactor: { en: 'Overhead tank factor (× daily demand)', bn: 'ওভারহেড ট্যাংক ফ্যাক্টর' },
  ugtFactor: { en: 'Underground tank factor (× daily demand)', bn: 'আন্ডারগ্রাউন্ড ট্যাংক ফ্যাক্টর' },
  pumpHours: { en: 'Pump running hours/day', bn: 'পাম্প চলার ঘণ্টা/দিন' },
  rainDownpipes: { en: 'Rainwater downpipes (building)', bn: 'বৃষ্টির পানির ডাউনপাইপ (ভবন)' },
  coldRiserPerFloor: { en: 'Cold water riser length per floor (m)', bn: 'প্রতি তলায় কোল্ড রাইজার (মি)' },
  hotRiserPerFloor: { en: 'Hot water riser length per floor (m)', bn: 'প্রতি তলায় হট রাইজার (মি)' },
  pprStickM: { en: 'PPR pipe standard stick (m)', bn: 'PPR পাইপ স্টিক (মি)' },
  pvcStickM: { en: 'PVC pipe standard stick (m)', bn: 'PVC পাইপ স্টিক (মি)' },
  clampPerM: { en: 'Pipe clamp spacing (m)', bn: 'পাইপ ক্ল্যাম্প ব্যবধান (মি)' },
}

// Main cable ampacity map (approx PVC single-core copper in conduit, conservative)
export const FEEDER_SIZES: Array<{ maxA: number; size: string }> = [
  { maxA: 32, size: '10' },
  { maxA: 40, size: '10' },
  { maxA: 63, size: '16' },
  { maxA: 80, size: '25' },
  { maxA: 125, size: '35' },
  { maxA: 999, size: '50' },
]

export function feederSizeForAmps(a: number): string {
  return FEEDER_SIZES.find((f) => a <= f.maxA)?.size ?? '50'
}

export function pickBreaker(amps: number): string {
  const std = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250]
  return String(std.find((s) => s >= amps) ?? 250)
}

export function pickDbWays(circuits: number): string {
  const ways = [4, 8, 12, 16, 24]
  return String(ways.find((w) => w >= circuits + 2) ?? 24)
}
