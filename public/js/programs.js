// Station programs as the phone app lists them (Settings > Station settings), read-only.
// Pure data: i18n.js merges PROG_TEXT, so this file imports nothing.
//
// The register of every program comes from the app's own table (decompiled libapp.so, see
// docs/API.md) and every value was checked against the phone's screen on 2026-10-28.
//   kind 'number'  : shown as `fn(raw) unit`, fn defaults to identity
//   kind 'toggle'  : 0 = off, 1 = on
//   kind 'enum'    : raw value picks the text key prog<N>o<value>; `fallback` covers other values
export const PROGRAMS = [
  { n: 1, reg: 'P15', kind: 'enum' },
  { n: 2, reg: 'P19', kind: 'number', unit: 'A' },
  { n: 3, reg: 'P16', kind: 'enum' },
  { n: 5, reg: 'P17', kind: 'enum', fallback: true },
  { n: 6, reg: 'P38', kind: 'toggle' },
  { n: 7, reg: 'P39', kind: 'toggle' },
  { n: 9, reg: 'P18', kind: 'enum' },
  { n: 10, reg: 'P20', kind: 'number', unit: 'V' },
  { n: 11, reg: 'P21', kind: 'number', unit: 'A' },
  { n: 12, reg: 'P46', kind: 'number', unit: '%' },
  { n: 13, reg: 'P45', kind: 'number', unit: '%' },
  { n: 16, reg: 'P14', kind: 'enum' },
  { n: 18, reg: 'P36', kind: 'toggle' },
  { n: 19, reg: 'P41', kind: 'toggle' },
  { n: 20, reg: 'P37', kind: 'toggle' },
  { n: 22, reg: 'P40', kind: 'toggle' },
  { n: 23, reg: 'P42', kind: 'toggle' },
  { n: 29, reg: 'P44', kind: 'number', unit: '%' },
  { n: 37, reg: 'P31', kind: 'enum' },
  { n: 38, reg: 'P32', kind: 'number', unit: 'A', fn: (v) => v * 2 }, // app lists 2, 4, ... A; raw is the list index
  { n: 39, reg: 'P33', kind: 'toggle' },
  { n: 41, reg: 'P1', kind: 'enum' },
  { n: 42, reg: 'P47', kind: 'number', unit: '%', fn: (v) => (v + 1) * 5 }, // 5 % steps, raw 10 = 55 %
  { n: 45, reg: 'P43', kind: 'number', unit: '%' },
];

export const REG_CYCLES = 'P48'; // battery cycle count, 106 in the app = P48 106
export const REG_CUTOFF = 'P44'; // program 29, station shutdown level (%)
export const REG_SYNCED = 'P65535'; // unix time of the inverter's last settings upload

export const PROG_TEXT = {
  uk: {
    prog1: 'Пріоритетне джерело живлення для навантаження', prog1d: 'Вибір пріоритетного джерела живлення для підключеного навантаження.',
    prog2: 'Максимальний загальний струм для зарядки батареї', prog2d: 'Струм від мережі + струм від сонячних панелей.',
    prog3: 'Діапазон вхідної напруги AC', prog3d: 'APL: 90–280 В, перемикання ≤ 20 мс. UPS: 170–280 В, перемикання ≤ 10 мс.',
    prog5: 'Тип батареї', prog5d: 'Тип підключеної батареї.',
    prog6: 'Перезапуск при перевантаженні', prog6d: 'Якщо вимкнено, у разі перевантаження станція виконає захисне вимкнення.',
    prog7: 'Перезапуск при перегріві', prog7d: 'Якщо вимкнено, у разі перегріву станція виконає захисне вимкнення.',
    prog9: 'Частота струму на виході', prog9d: 'В автономному режимі.',
    prog10: 'Напруга на виході', prog10d: 'В автономному режимі.',
    prog11: 'Макс. DC-струм для зарядки батареї від мережі', prog11d: 'Швидкість заряджання батареї від мережі.',
    prog12: 'Нижня межа заряду батареї для переходу на живлення від мережі (в режимі SBU, MKS)', prog12d: 'Рівень, до якого розряджається батарея перед перемиканням на міську мережу.',
    prog13: 'Верхня межа заряду батареї для переходу на живлення від батареї (в режимі SBU, MKS)', prog13d: 'Рівень заряду, при досягненні якого станція відключить міську мережу і перейде на автономне живлення.',
    prog16: 'Пріоритетне джерело живлення для заряджання батареї', prog16d: 'Порядок використання джерел живлення для зарядки батареї.',
    prog18: 'Звукові сповіщення та сигнали', prog18d: 'Якщо вимкнено, увімкнено беззвучний режим.',
    prog19: 'Дисплей: автоматичне повернення до головного екрану', prog19d: 'Повернення на головний екран через 1 хвилину бездіяльності.',
    prog20: 'Дисплей: постійно увімкнений', prog20d: 'Постійна підсвітка екрана.',
    prog22: 'Звуковий сигнал при зміні джерела живлення', prog22d: 'Програма 18 має пріоритет.',
    prog23: 'Перехід на мережу при перевантаженні в автономному режимі', prog23d: 'Якщо вимкнено, при перевантаженні від батареї станція виконає захисне вимкнення без перемикання на мережу.',
    prog29: 'Рівень заряду для вимкнення станції', prog29d: 'Рівень заряду, при якому станція автоматично вимкнеться і перейде в суперекономний режим розряду.',
    prog37: 'Генерація енергії назад в мережу (Grid-Tie). Продаж', prog37d: 'Якщо вимкнено (Off-Grid), сонячна енергія йде лише на ваші прилади та заряджання батареї.',
    prog38: 'Максимальний струм генерації (Grid-Tie)', prog38d: 'Максимальний струм, який станція може віддавати в міську електромережу.',
    prog39: 'LED-індикатор джерела живлення', prog39d: 'Підсвітка корпусу станції, що показує поточне джерело.',
    prog41: 'Розподіл потужності в автономному режимі', prog41d: 'Режим «L2F»: станція живить усі виходи («Main» і «Second») одночасно, поки батарея не розрядиться повністю.',
    prog42: 'Рівень заряду батареї для відключення виходів «Main» в автономному режимі', prog42d: 'Відключення некритичного навантаження при досягненні певного рівня розряду батареї.',
    prog45: 'Максимальна потужність виходів «Second»', prog45d: 'Максимально дозволена потужність для виходів «Second» після того, як виходи «Main» були відключені.',
    on: 'Увімкнено', off: 'Вимкнено', unsetValue: 'Невідомо',
    prog1o0: 'Мережа', prog1o1: 'Сонячна енергія', prog1o2: 'Пріоритет SBU', prog1o3: 'Пріоритет MKS',
    prog3o0: 'APL (90–280 В)', prog3o1: 'UPS (170–280 В)',
    prog5o4: 'LiFePO4', prog5fb: 'Не підтримується',
    prog9o0: '50 Гц', prog9o1: '60 Гц',
    prog16o0: 'Спочатку сонячна', prog16o1: 'Сонячна + мережа', prog16o2: 'Тільки сонячна',
    prog37o0: 'Off-Grid', prog37o1: 'Hybrid (продаж надлишку)',
    prog41o0: 'L2F', prog41o1: 'L20',
  },
  en: {
    prog1: 'Priority power source for the load', prog1d: 'Selects the priority power source for the connected load.',
    prog2: 'Maximum total battery charging current', prog2d: 'Grid current + solar panel current.',
    prog3: 'AC input voltage range', prog3d: 'APL: 90–280 V, switching ≤ 20 ms. UPS: 170–280 V, switching ≤ 10 ms.',
    prog5: 'Battery type', prog5d: 'Type of the connected battery.',
    prog6: 'Restart on overload', prog6d: 'When off, the station performs a protective shutdown on overload.',
    prog7: 'Restart on over-temperature', prog7d: 'When off, the station performs a protective shutdown on over-temperature.',
    prog9: 'Output frequency', prog9d: 'In off-grid mode.',
    prog10: 'Output voltage', prog10d: 'In off-grid mode.',
    prog11: 'Max. DC charging current from the grid', prog11d: 'Battery charging speed from the grid.',
    prog12: 'Lower battery charge limit for switching to grid power (SBU, MKS)', prog12d: 'The level the battery discharges to before switching to the city grid.',
    prog13: 'Upper battery charge limit for switching to battery power (SBU, MKS)', prog13d: 'The charge level at which the station disconnects from the grid and runs off-grid.',
    prog16: 'Priority power source for battery charging', prog16d: 'Order of power sources used to charge the battery.',
    prog18: 'Sound notifications and signals', prog18d: 'When off, silent mode is enabled.',
    prog19: 'Display: return to the main screen automatically', prog19d: 'Returns to the main screen after 1 minute of inactivity.',
    prog20: 'Display: always on', prog20d: 'Constant screen backlight.',
    prog22: 'Beep when the power source changes', prog22d: 'Program 18 takes priority.',
    prog23: 'Transfer to grid on overload in battery mode', prog23d: 'When off, the station shuts down on battery overload instead of switching to the grid.',
    prog29: 'Charge level for station shutdown', prog29d: 'The charge level at which the station shuts down and enters a super energy-saving discharge mode.',
    prog37: 'Grid-Tie: feed energy back to the grid (selling)', prog37d: 'When off (Off-Grid), solar energy goes only to your appliances and battery charging.',
    prog38: 'Maximum generation current (Grid-Tie)', prog38d: 'The maximum current the station can feed into the city grid.',
    prog39: 'LED power source indicator', prog39d: 'The housing LED that shows the current power source.',
    prog41: 'Power distribution in off-grid mode', prog41d: '"L2F": the station powers all outputs ("Main" and "Second") at once until the battery is fully discharged.',
    prog42: 'Charge level for switching off "Main" outputs in off-grid mode', prog42d: 'Disconnects non-critical load when the battery reaches a certain discharge level.',
    prog45: 'Maximum power of "Second" outputs', prog45d: 'Maximum allowed power for "Second" outputs after the "Main" outputs have been switched off.',
    on: 'On', off: 'Off', unsetValue: 'Unknown',
    prog1o0: 'Grid', prog1o1: 'Solar energy', prog1o2: 'SBU priority', prog1o3: 'MKS priority',
    prog3o0: 'APL (90–280 V)', prog3o1: 'UPS (170–280 V)',
    prog5o4: 'LiFePO4', prog5fb: 'Not supported',
    prog9o0: '50 Hz', prog9o1: '60 Hz',
    prog16o0: 'Solar first', prog16o1: 'Solar + grid', prog16o2: 'Solar only',
    prog37o0: 'Off-Grid', prog37o1: 'Hybrid (sell excess)',
    prog41o0: 'L2F', prog41o1: 'L20',
  },
};
