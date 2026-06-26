export type CountryMarketIndex = {
  isoNumeric: number
  country: string
  symbol: string
  indexName: string
}

export const countryMarketIndexes: CountryMarketIndex[] = [
  { isoNumeric: 840, country: 'United States', symbol: '^GSPC', indexName: 'S&P 500' },
  { isoNumeric: 826, country: 'United Kingdom', symbol: '^FTSE', indexName: 'FTSE 100' },
  { isoNumeric: 276, country: 'Germany', symbol: '^GDAXI', indexName: 'DAX' },
  { isoNumeric: 250, country: 'France', symbol: '^FCHI', indexName: 'CAC 40' },
  { isoNumeric: 380, country: 'Italy', symbol: 'FTSEMIB.MI', indexName: 'FTSE MIB' },
  { isoNumeric: 724, country: 'Spain', symbol: '^IBEX', indexName: 'IBEX 35' },
  { isoNumeric: 528, country: 'Netherlands', symbol: '^AEX', indexName: 'AEX' },
  { isoNumeric: 756, country: 'Switzerland', symbol: '^SSMI', indexName: 'SMI' },
  { isoNumeric: 752, country: 'Sweden', symbol: '^OMX', indexName: 'OMX Stockholm 30' },
  { isoNumeric: 40, country: 'Austria', symbol: '^ATX', indexName: 'ATX' },
  { isoNumeric: 56, country: 'Belgium', symbol: '^BFX', indexName: 'BEL 20' },
  { isoNumeric: 208, country: 'Denmark', symbol: '^OMXC20', indexName: 'OMX Copenhagen 20' },
  { isoNumeric: 578, country: 'Norway', symbol: '^OSEAX', indexName: 'Oslo All-Share' },
  { isoNumeric: 616, country: 'Poland', symbol: '^WIG20', indexName: 'WIG 20' },
  { isoNumeric: 620, country: 'Portugal', symbol: '^PSI20', indexName: 'PSI 20' },
  { isoNumeric: 372, country: 'Ireland', symbol: '^ISEQ', indexName: 'ISEQ All Share' },
  { isoNumeric: 203, country: 'Czech Republic', symbol: '^PX', indexName: 'PX Index' },
  { isoNumeric: 348, country: 'Hungary', symbol: '^BUX', indexName: 'BUX' },
  { isoNumeric: 792, country: 'Turkey', symbol: 'XU100.IS', indexName: 'BIST 100' },
  { isoNumeric: 246, country: 'Finland', symbol: '^OMXH25', indexName: 'OMX Helsinki 25' },
  { isoNumeric: 300, country: 'Greece', symbol: 'GREK', indexName: 'Global X MSCI Greece ETF' },
  { isoNumeric: 233, country: 'Estonia', symbol: '^OMXTGI', indexName: 'OMX Baltic' },
  { isoNumeric: 392, country: 'Japan', symbol: '^N225', indexName: 'Nikkei 225' },
  { isoNumeric: 156, country: 'China', symbol: '000001.SS', indexName: 'SSE Composite' },
  { isoNumeric: 356, country: 'India', symbol: '^BSESN', indexName: 'BSE Sensex' },
  { isoNumeric: 410, country: 'South Korea', symbol: '^KS11', indexName: 'KOSPI' },
  { isoNumeric: 158, country: 'Taiwan', symbol: '^TWII', indexName: 'TSEC Weighted' },
  { isoNumeric: 344, country: 'Hong Kong', symbol: '^HSI', indexName: 'Hang Seng' },
  { isoNumeric: 702, country: 'Singapore', symbol: '^STI', indexName: 'STI' },
  { isoNumeric: 360, country: 'Indonesia', symbol: '^JKSE', indexName: 'IDX Composite' },
  { isoNumeric: 458, country: 'Malaysia', symbol: '^KLSE', indexName: 'FTSE Bursa Malaysia KLCI' },
  { isoNumeric: 764, country: 'Thailand', symbol: '^SET.BK', indexName: 'SET Index' },
  { isoNumeric: 608, country: 'Philippines', symbol: 'PSEI.PS', indexName: 'PSEi' },
  { isoNumeric: 554, country: 'New Zealand', symbol: '^NZ50', indexName: 'S&P/NZX 50' },
  { isoNumeric: 36, country: 'Australia', symbol: '^AXJO', indexName: 'S&P/ASX 200' },
  { isoNumeric: 124, country: 'Canada', symbol: '^GSPTSE', indexName: 'S&P/TSX Composite' },
  { isoNumeric: 484, country: 'Mexico', symbol: '^MXX', indexName: 'S&P/BMV IPC' },
  { isoNumeric: 76, country: 'Brazil', symbol: '^BVSP', indexName: 'Ibovespa' },
  { isoNumeric: 152, country: 'Chile', symbol: '^IPSA', indexName: 'S&P IPSA' },
  { isoNumeric: 604, country: 'Peru', symbol: '^SPBLPGPT', indexName: 'S&P/BVL General' },
  { isoNumeric: 170, country: 'Colombia', symbol: 'GXG', indexName: 'Global X MSCI Colombia ETF' },
  { isoNumeric: 818, country: 'Egypt', symbol: '^CASE30', indexName: 'EGX 30' },
  { isoNumeric: 710, country: 'South Africa', symbol: '^JN0U.JO', indexName: 'Top 40 USD' },
  { isoNumeric: 376, country: 'Israel', symbol: '^TA125.TA', indexName: 'TA-125' },
  { isoNumeric: 682, country: 'Saudi Arabia', symbol: '^TASI.SR', indexName: 'Tadawul All Share' },
  { isoNumeric: 643, country: 'Russia', symbol: 'IMOEX.ME', indexName: 'MOEX Russia' },
  { isoNumeric: 32, country: 'Argentina', symbol: '^MERV', indexName: 'MERVAL' },
]

export const countryIndexByIso = new Map(countryMarketIndexes.map((entry) => [entry.isoNumeric, entry]))

export function collectCountryIndexSymbols() {
  return [...new Set(countryMarketIndexes.map((market) => market.symbol))]
}
