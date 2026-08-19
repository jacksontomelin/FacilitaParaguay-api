const ShoppingChinaScraper = require('./ShoppingChinaScraper');
const NewZoneScraper = require('./NewZoneScraper');
const NisseiScraper = require('./NisseiScraper');
const CellShopScraper = require('./CellShopScraper');
const MegaScraper = require('./MegaScraper');
const CasaBoScraper = require('./CasaBoScraper');
const MobileZoneScraper = require('./MobileZoneScraper');
const OneClickScraper = require('./OneClickScraper');
const StarCompanyScraper = require('./StarCompanyScraper');
const LaPetisqueraScraper = require('./LaPetisqueraScraper');
const VisaoVipScraper = require('./VisaoVipScraper');
const EleganciaCompanyScraper = require('./EleganciaCompanyScraper');
const MultiPassScraper = require('./MultiPassScraper');
const AgatresScraper = require('./AgatresScraper');
const MadridCenterScraper = require('./MadridCenterScraper');
const FlytecScraper = require('./FlytecScraper');
const AtacadoConnectScraper = require('./AtacadoConnectScraper');
const PontocomScraper = require('./PontocomScraper');
const TopdekScraper = require('./TopdekScraper');
const IntershopScraper = require('./IntershopScraper');

const STORE_CONFIGS = {
  'shopping-china':       { Class: ShoppingChinaScraper },
  'newzone':              { Class: NewZoneScraper },
  'nissei':               { Class: NisseiScraper },
  'cellshop':             { Class: CellShopScraper },
  'mega-eletronicos':     { Class: MegaScraper },
  'casa-bo':              { Class: CasaBoScraper },
  'mobile-zone':          { Class: MobileZoneScraper },
  'one-click':            { Class: OneClickScraper },
  'star-company':         { Class: StarCompanyScraper },
  'la-petisquera':        { Class: LaPetisqueraScraper },
  'visaovip':             { Class: VisaoVipScraper },
  'elegancia-company':    { Class: EleganciaCompanyScraper },
  'multipass':            { Class: MultiPassScraper },
  'agatres':              { Class: AgatresScraper },
  'madrid-center':        { Class: MadridCenterScraper },
  'flytec-computers':     { Class: FlytecScraper },
  'atacado-connect':      { Class: AtacadoConnectScraper },
  'pontocom':             { Class: PontocomScraper },
  'topdek-informatica':   { Class: TopdekScraper },
  'intershop-importados': { Class: IntershopScraper },
};

function createScraper(storeSlug) {
  const c = STORE_CONFIGS[storeSlug];
  if (!c) throw new Error(`Scraper não configurado: ${storeSlug}`);
  return new c.Class();
}

function getAvailableScrapers() { return Object.keys(STORE_CONFIGS); }

module.exports = { createScraper, getAvailableScrapers, STORE_CONFIGS };
