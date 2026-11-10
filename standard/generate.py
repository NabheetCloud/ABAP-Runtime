#!/usr/bin/env python3
"""Generates the SAP standard layer of RAP Studio (standard/s4hana): organisational units, configuration and master data
of an S/4HANA system as database tables with SAP's table and field names, the released CDS views of the virtual data
model on top (I_Product, I_Customer, ...), and seed data like a fresh best-practice client.

The definitions are RAP Studio's own (a subset of the fields, simple types), not SAP's sources. View and table names
follow SAP's Cloudification Repository (github.com/SAP/abap-atc-cr-cv-s4hc): the tables are "not to be released",
the views below are their released successors.

    python3 standard/generate.py      (rewrites standard/s4hana/src and standard/s4hana/data)
"""
import json, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 's4hana')
SRC, DATA = os.path.join(OUT, 'src'), os.path.join(OUT, 'data')

# ------------------------------------------------------------------ types
def C(n): return f'abap.char({n})'
def N(n): return f'abap.numc({n})'
DATS, TIMS, LANG, CUKY, UNIT, INT = 'abap.dats', 'abap.tims', 'abap.lang', 'abap.cuky', 'abap.unit(3)', 'abap.int4'
def DEC(p, s): return f'abap.dec({p},{s})'
def CURR(p, s): return f'abap.curr({p},{s})'
def QUAN(p, s): return f'abap.quan({p},{s})'

TABLES = {}   # name -> (label, [(field, type, key, ref)])
def table(name, label, *fields):
    TABLES[name] = (label, [('mandt', 'abap.clnt', True, None)] + [f if len(f) == 4 else (*f, None) for f in fields])
def K(f, t): return (f, t, True)
def F(f, t, ref=None): return (f, t, False, ref)

# ------------------------------------------------------------------ 1. organisation and configuration
table('t000_dummy', '')  # placeholder removed below (T000 comes from open-abap)
del TABLES['t000_dummy']
table('t002', 'Languages', K('spras', LANG), F('laiso', C(2)))
table('t002t', 'Language texts', K('spras', LANG), K('sprsl', LANG), F('sptxt', C(16)))
table('t005', 'Countries', K('land1', C(3)), F('intca', C(2)), F('intca3', C(3)), F('intcn3', N(3)), F('waers', CUKY), F('spras', LANG), F('xegld', C(1)))
table('t005t', 'Country texts', K('spras', LANG), K('land1', C(3)), F('landx', C(15)), F('landx50', C(50)), F('natio', C(15)))
table('t005s', 'Regions', K('land1', C(3)), K('bland', C(3)))
table('t005u', 'Region texts', K('spras', LANG), K('land1', C(3)), K('bland', C(3)), F('bezei', C(20)))
table('tcurc', 'Currencies', K('waers', CUKY), F('isocd', C(3)), F('altwr', N(3)), F('xprimary', C(1)))
table('tcurt', 'Currency texts', K('spras', LANG), K('waers', CUKY), F('ltext', C(40)), F('ktext', C(15)))
table('tcurx', 'Decimal places of currencies', K('currkey', CUKY), F('currdec', 'abap.int1'))
table('tcurv', 'Exchange rate types', K('kurst', C(4)), F('xinvr', C(1)))
table('tcurw', 'Exchange rate type texts', K('spras', LANG), K('kurst', C(4)), F('curvw', C(40)))
table('tcurr', 'Exchange rates', K('kurst', C(4)), K('fcurr', CUKY), K('tcurr', CUKY), K('gdatu', DATS), F('ukurs', DEC(9, 5)), F('ffact', DEC(9, 0)), F('tfact', DEC(9, 0)))
table('t006', 'Units of measure', K('msehi', UNIT), F('dimid', C(6)), F('isocode', C(3)), F('andec', 'abap.int2'), F('primary', C(1)))
table('t006a', 'Unit of measure texts', K('spras', LANG), K('msehi', UNIT), F('mseh3', C(3)), F('mseh6', C(6)), F('msehl', C(30)))
table('t004', 'Charts of accounts', K('ktopl', C(4)), F('dspra', LANG), F('saknr_len', N(2)))
table('t004t', 'Chart of accounts texts', K('spras', LANG), K('ktopl', C(4)), F('ktplt', C(50)))
table('t009', 'Fiscal year variants', K('periv', C(2)), F('anzbp', N(3)), F('anzsp', N(2)))
table('t009t', 'Fiscal year variant texts', K('spras', LANG), K('periv', C(2)), F('ltext', C(30)))
table('t880', 'Companies', K('rcomp', C(6)), F('name1', C(30)), F('cntry', C(3)), F('curr', CUKY))
table('t001', 'Company codes', K('bukrs', C(4)), F('butxt', C(25)), F('ort01', C(25)), F('land1', C(3)), F('waers', CUKY), F('spras', LANG),
      F('ktopl', C(4)), F('periv', C(2)), F('rcomp', C(6)), F('adrnr', C(10)), F('stceg', C(20)))
table('tka01', 'Controlling areas', K('kokrs', C(4)), F('bezei', C(25)), F('waers', CUKY), F('ktopl', C(4)), F('lmona', N(2)))
table('tka02', 'Company code assignment to controlling area', K('bukrs', C(4)), F('kokrs', C(4)))
table('t001k', 'Valuation areas', K('bwkey', C(4)), F('bukrs', C(4)))
table('t001w', 'Plants', K('werks', C(4)), F('name1', C(30)), F('bwkey', C(4)), F('kunnr', C(10)), F('lifnr', C(10)), F('fabkl', C(2)), F('stras', C(30)),
      F('pstlz', C(10)), F('ort01', C(25)), F('land1', C(3)), F('regio', C(3)), F('ekorg', C(4)), F('vkorg', C(4)), F('vtweg', C(2)), F('spart', C(2)),
      F('spras', LANG), F('adrnr', C(10)), F('vlfkz', C(1)))
table('t001l', 'Storage locations', K('werks', C(4)), K('lgort', C(4)), F('lgobe', C(16)), F('vkorg', C(4)), F('vtweg', C(2)))
table('tvko', 'Sales organizations', K('vkorg', C(4)), F('waers', CUKY), F('bukrs', C(4)), F('kunnr', C(10)))
table('tvkot', 'Sales organization texts', K('spras', LANG), K('vkorg', C(4)), F('vtext', C(20)))
table('tvtw', 'Distribution channels', K('vtweg', C(2)))
table('tvtwt', 'Distribution channel texts', K('spras', LANG), K('vtweg', C(2)), F('vtext', C(20)))
table('tspa', 'Divisions', K('spart', C(2)))
table('tspat', 'Division texts', K('spras', LANG), K('spart', C(2)), F('vtext', C(20)))
table('tvta', 'Sales areas', K('vkorg', C(4)), K('vtweg', C(2)), K('spart', C(2)))
table('t024e', 'Purchasing organizations', K('ekorg', C(4)), F('ekotx', C(20)), F('bukrs', C(4)))
table('t024', 'Purchasing groups', K('ekgrp', C(3)), F('eknam', C(18)), F('tel_number', C(30)), F('smtp_addr', C(241)))
table('t052', 'Terms of payment', K('zterm', C(4)), F('ztag1', N(3)), F('zprz1', DEC(5, 3)), F('ztag2', N(3)), F('zprz2', DEC(5, 3)), F('ztag3', N(3)))
table('tvzbt', 'Terms of payment texts', K('spras', LANG), K('zterm', C(4)), F('vtext', C(30)))
table('tinc', 'Incoterms', K('inco1', C(3)), F('ortob', C(1)))
table('tinct', 'Incoterms texts', K('spras', LANG), K('inco1', C(3)), F('bezei', C(30)))
table('tvsb', 'Shipping conditions', K('vsbed', C(2)))
table('tvsbt', 'Shipping condition texts', K('spras', LANG), K('vsbed', C(2)), F('vtext', C(20)))
table('t134', 'Material (product) types', K('mtart', C(4)), F('mtref', C(4)), F('kkref', C(4)))
table('t134t', 'Material type texts', K('spras', LANG), K('mtart', C(4)), F('mtbez', C(25)))
table('t023', 'Material (product) groups', K('matkl', C(9)), F('begru', C(4)))
table('t023t', 'Material group texts', K('spras', LANG), K('matkl', C(9)), F('wgbez', C(20)), F('wgbez60', C(60)))
table('t438a', 'MRP types', K('dismm', C(2)), F('disvf', C(1)))
table('t438t', 'MRP type texts', K('spras', LANG), K('dismm', C(2)), F('dibez', C(30)))
table('t077d', 'Customer account groups', K('ktokd', C(4)), F('numkr', C(2)))
table('t077x', 'Customer account group texts', K('spras', LANG), K('ktokd', C(4)), F('txt30', C(30)))
table('t077k', 'Supplier account groups', K('ktokk', C(4)), F('numkr', C(2)))
table('t077y', 'Supplier account group texts', K('spras', LANG), K('ktokk', C(4)), F('txt30', C(30)))
table('tb001', 'Business partner groupings', K('bu_group', C(4)), F('nrrng', C(2)))
table('tb002', 'Business partner grouping texts', K('spras', LANG), K('bu_group', C(4)), F('txt40', C(40)))
table('t077s', 'G/L account groups', K('ktopl', C(4)), K('ktoks', C(4)))
table('t077z', 'G/L account group texts', K('spras', LANG), K('ktopl', C(4)), K('ktoks', C(4)), F('txt30', C(30)))

# ------------------------------------------------------------------ 2. master data
table('adrc', 'Addresses', K('addrnumber', C(10)), K('date_from', DATS), K('nation', C(1)), F('name1', C(40)), F('name2', C(40)), F('street', C(60)),
      F('house_num1', C(10)), F('post_code1', C(10)), F('city1', C(40)), F('country', C(3)), F('region', C(3)), F('langu', LANG), F('tel_number', C(30)),
      F('smtp_addr', C(241)))
table('but000', 'Business partners', K('partner', C(10)), F('type', C(1)), F('bu_group', C(4)), F('bu_sort1', C(20)), F('name_org1', C(40)), F('name_org2', C(40)),
      F('name_first', C(40)), F('name_last', C(40)), F('xblck', C(1)), F('xdele', C(1)), F('crdat', DATS), F('crusr', C(12)), F('chdat', DATS), F('partner_guid', 'abap.raw(16)'))
table('but020', 'Business partner addresses', K('partner', C(10)), K('addrnumber', C(10)), F('xdfadr', C(1)))
table('but100', 'Business partner roles', K('partner', C(10)), K('rltyp', C(6)), K('dfval', C(30)), F('valid_from', DATS), F('valid_to', DATS))
table('tb003', 'Business partner roles (customizing)', K('role', C(6)))
table('tb003t', 'Business partner role texts', K('spras', LANG), K('role', C(6)), F('rltitl', C(40)))
table('kna1', 'Customers (general data)', K('kunnr', C(10)), F('name1', C(35)), F('name2', C(35)), F('ort01', C(35)), F('pstlz', C(10)), F('stras', C(35)),
      F('land1', C(3)), F('regio', C(3)), F('spras', LANG), F('telf1', C(16)), F('stcd1', C(16)), F('stceg', C(20)), F('ktokd', C(4)), F('adrnr', C(10)),
      F('loevm', C(1)), F('aufsd', C(2)), F('erdat', DATS), F('ernam', C(12)), F('lifnr', C(10)))
table('knb1', 'Customers (company code data)', K('kunnr', C(10)), K('bukrs', C(4)), F('akont', C(10)), F('zterm', C(4)), F('busab', C(2)), F('loevm', C(1)))
table('knvv', 'Customers (sales area data)', K('kunnr', C(10)), K('vkorg', C(4)), K('vtweg', C(2)), K('spart', C(2)), F('waers', CUKY), F('zterm', C(4)),
      F('inco1', C(3)), F('inco2', C(28)), F('vsbed', C(2)), F('konda', C(2)), F('kalks', C(1)), F('aufsd', C(2)), F('loevm', C(1)))
table('lfa1', 'Suppliers (general data)', K('lifnr', C(10)), F('name1', C(35)), F('name2', C(35)), F('ort01', C(35)), F('pstlz', C(10)), F('stras', C(35)),
      F('land1', C(3)), F('regio', C(3)), F('spras', LANG), F('telf1', C(16)), F('stcd1', C(16)), F('stceg', C(20)), F('ktokk', C(4)), F('adrnr', C(10)),
      F('loevm', C(1)), F('sperr', C(1)), F('erdat', DATS), F('ernam', C(12)), F('kunnr', C(10)))
table('lfb1', 'Suppliers (company code data)', K('lifnr', C(10)), K('bukrs', C(4)), F('akont', C(10)), F('zterm', C(4)), F('loevm', C(1)))
table('lfm1', 'Suppliers (purchasing organization data)', K('lifnr', C(10)), K('ekorg', C(4)), F('waers', CUKY), F('zterm', C(4)), F('inco1', C(3)),
      F('inco2', C(28)), F('webre', C(1)), F('verkf', C(30)), F('telf1', C(16)), F('loevm', C(1)))
table('mara', 'Products (general data)', K('matnr', C(40)), F('mtart', C(4)), F('matkl', C(9)), F('meins', UNIT), F('brgew', QUAN(13, 3), 'mara.gewei'),
      F('ntgew', QUAN(13, 3), 'mara.gewei'), F('gewei', UNIT), F('volum', QUAN(13, 3), 'mara.voleh'), F('voleh', UNIT), F('spart', C(2)), F('bismt', C(40)),
      F('ean11', C(18)), F('mstae', C(2)), F('lvorm', C(1)), F('ersda', DATS), F('ernam', C(12)), F('laeda', DATS))
table('makt', 'Product descriptions', K('matnr', C(40)), K('spras', LANG), F('maktx', C(40)))
table('marm', 'Units of measure of products', K('matnr', C(40)), K('meinh', UNIT), F('umrez', DEC(5, 0)), F('umren', DEC(5, 0)), F('ean11', C(18)))
table('marc', 'Products (plant data)', K('matnr', C(40)), K('werks', C(4)), F('ekgrp', C(3)), F('dismm', C(2)), F('dispo', C(3)), F('beskz', C(1)),
      F('plifz', DEC(3, 0)), F('minbe', QUAN(13, 3)), F('eisbe', QUAN(13, 3)), F('prctr', C(10)), F('mmsta', C(2)), F('lvorm', C(1)))
table('mard', 'Products (storage location data and stock)', K('matnr', C(40)), K('werks', C(4)), K('lgort', C(4)), F('labst', QUAN(13, 3)), F('insme', QUAN(13, 3)),
      F('speme', QUAN(13, 3)), F('lgpbe', C(10)), F('lvorm', C(1)))
table('mbew', 'Products (valuation)', K('matnr', C(40)), K('bwkey', C(4)), K('bwtar', C(10)), F('vprsv', C(1)), F('verpr', CURR(11, 2), 'mbew.waers'),
      F('stprs', CURR(11, 2), 'mbew.waers'), F('peinh', DEC(5, 0)), F('bklas', C(4)), F('waers', CUKY), F('lbkum', QUAN(13, 3)), F('salk3', CURR(13, 2), 'mbew.waers'))
table('mvke', 'Products (sales data)', K('matnr', C(40)), K('vkorg', C(4)), K('vtweg', C(2)), F('dwerk', C(4)), F('vrkme', UNIT), F('aumng', QUAN(13, 3)),
      F('mtpos', C(4)), F('lvorm', C(1)))
table('ska1', 'G/L accounts (chart of accounts)', K('ktopl', C(4)), K('saknr', C(10)), F('xbilk', C(1)), F('gvtyp', C(2)), F('ktoks', C(4)), F('glaccount_type', C(1)))
table('skat', 'G/L account texts', K('spras', LANG), K('ktopl', C(4)), K('saknr', C(10)), F('txt20', C(20)), F('txt50', C(50)))
table('skb1', 'G/L accounts (company code)', K('bukrs', C(4)), K('saknr', C(10)), F('waers', CUKY), F('mitkz', C(1)), F('xspeb', C(1)), F('xopvw', C(1)))
table('csks', 'Cost centers', K('kokrs', C(4)), K('kostl', C(10)), K('datbi', DATS), F('datab', DATS), F('bukrs', C(4)), F('prctr', C(10)), F('kosar', C(1)),
      F('verak', C(20)), F('waers', CUKY))
table('cskt', 'Cost center texts', K('spras', LANG), K('kokrs', C(4)), K('kostl', C(10)), K('datbi', DATS), F('ktext', C(20)), F('ltext', C(40)))
table('cepc', 'Profit centers', K('prctr', C(10)), K('datbi', DATS), K('kokrs', C(4)), F('datab', DATS), F('bukrs', C(4)), F('verak', C(20)), F('segment', C(10)))
table('cepct', 'Profit center texts', K('spras', LANG), K('prctr', C(10)), K('datbi', DATS), K('kokrs', C(4)), F('ktext', C(20)), F('ltext', C(40)))
table('ttzz', 'Time zones', K('tzone', C(6)), F('zonerule', C(6)), F('dstrule', C(6)), F('flagactive', C(1)))
table('ttzzt', 'Time zone texts', K('langu', LANG), K('tzone', C(6)), F('descript', C(50)))
table('bnka', 'Banks', K('banks', C(3)), K('bankl', C(15)), F('banka', C(60)), F('ort01', C(35)), F('stras', C(35)), F('swift', C(11)), F('loevm', C(1)))

# ------------------------------------------------------------------ seed data (a best-practice-like demo client)
D = {}
def rows(t, *recs): D.setdefault(t, []).extend(recs)
LANGS = [('E', 'EN', 'English'), ('D', 'DE', 'German'), ('F', 'FR', 'French'), ('S', 'ES', 'Spanish'), ('I', 'IT', 'Italian'), ('J', 'JA', 'Japanese'), ('1', 'ZH', 'Chinese'), ('H', 'HI', 'Hindi')]
rows('t002', *[{'spras': s, 'laiso': i} for s, i, _ in LANGS])
rows('t002t', *[{'spras': 'E', 'sprsl': s, 'sptxt': t} for s, _, t in LANGS])
TZONES = [('UTC', 'UTC', '', 'Coordinated Universal Time'), ('CET', 'UTC+1', 'EU', 'Central Europe'), ('EST', 'UTC-5', 'USA', 'Eastern Time (USA)'),
          ('CST', 'UTC-6', 'USA', 'Central Time (USA)'), ('PST', 'UTC-8', 'USA', 'Pacific Time (USA)'), ('INDIA', 'UTC+53', '', 'India'),
          ('JAPAN', 'UTC+9', '', 'Japan'), ('CHINA', 'UTC+8', '', 'China'), ('GMTUK', 'UTC', 'EU', 'United Kingdom'), ('AUSNSW', 'UTC+10', 'AUSNSW', 'New South Wales')]
rows('ttzz', *[{'tzone': z, 'zonerule': r, 'dstrule': d, 'flagactive': 'X'} for z, r, d, _ in TZONES])
rows('ttzzt', *[{'langu': 'E', 'tzone': z, 'descript': t} for z, _, _, t in TZONES])
COUNTRIES = [  # code, iso3, num, currency, language, EU, name, nationality
    ('DE', 'DEU', '276', 'EUR', 'D', 'X', 'Germany', 'German'), ('US', 'USA', '840', 'USD', 'E', '', 'United States', 'American'),
    ('IN', 'IND', '356', 'INR', 'E', '', 'India', 'Indian'), ('GB', 'GBR', '826', 'GBP', 'E', '', 'United Kingdom', 'British'),
    ('FR', 'FRA', '250', 'EUR', 'F', 'X', 'France', 'French'), ('NL', 'NLD', '528', 'EUR', 'E', 'X', 'Netherlands', 'Dutch'),
    ('IT', 'ITA', '380', 'EUR', 'I', 'X', 'Italy', 'Italian'), ('ES', 'ESP', '724', 'EUR', 'S', 'X', 'Spain', 'Spanish'),
    ('AT', 'AUT', '040', 'EUR', 'D', 'X', 'Austria', 'Austrian'), ('CH', 'CHE', '756', 'CHF', 'D', '', 'Switzerland', 'Swiss'),
    ('JP', 'JPN', '392', 'JPY', 'J', '', 'Japan', 'Japanese'), ('CN', 'CHN', '156', 'CNY', '1', '', 'China', 'Chinese'),
    ('AU', 'AUS', '036', 'AUD', 'E', '', 'Australia', 'Australian'), ('CA', 'CAN', '124', 'CAD', 'E', '', 'Canada', 'Canadian'),
    ('BR', 'BRA', '076', 'BRL', 'E', '', 'Brazil', 'Brazilian'), ('SG', 'SGP', '702', 'SGD', 'E', '', 'Singapore', 'Singaporean'),
    ('AE', 'ARE', '784', 'AED', 'E', '', 'United Arab Emirates', 'Emirati'), ('MX', 'MEX', '484', 'MXN', 'S', '', 'Mexico', 'Mexican')]
rows('t005', *[{'land1': c, 'intca': c, 'intca3': i3, 'intcn3': n, 'waers': w, 'spras': l, 'xegld': eu} for c, i3, n, w, l, eu, _, _ in COUNTRIES])
rows('t005t', *[{'spras': 'E', 'land1': c, 'landx': name[:15], 'landx50': name, 'natio': nat[:15]} for c, _, _, _, _, _, name, nat in COUNTRIES])
rows('t005t', *[{'spras': 'D', 'land1': c, 'landx': n[:15], 'landx50': n, 'natio': ''} for c, n in [('DE', 'Deutschland'), ('US', 'USA'), ('IN', 'Indien'), ('GB', 'Großbritannien'), ('FR', 'Frankreich'), ('AT', 'Österreich'), ('CH', 'Schweiz')]])
REGIONS = [('DE', 'BW', 'Baden-Württemberg'), ('DE', 'BY', 'Bavaria'), ('DE', 'BE', 'Berlin'), ('DE', 'HH', 'Hamburg'), ('DE', 'NW', 'North Rhine-Westphalia'),
           ('US', 'CA', 'California'), ('US', 'NY', 'New York'), ('US', 'TX', 'Texas'), ('US', 'IL', 'Illinois'), ('US', 'PA', 'Pennsylvania'),
           ('IN', '13', 'Maharashtra'), ('IN', '10', 'Karnataka'), ('IN', '07', 'Delhi'), ('IN', '22', 'Tamil Nadu'), ('IN', '06', 'Haryana'), ('IN', '11', 'Kerala'),
           ('GB', 'LDN', 'London'), ('CA', 'ON', 'Ontario'), ('AU', 'NSW', 'New South Wales')]
rows('t005s', *[{'land1': c, 'bland': r} for c, r, _ in REGIONS])
rows('t005u', *[{'spras': 'E', 'land1': c, 'bland': r, 'bezei': n[:20]} for c, r, n in REGIONS])
CURRENCIES = [('EUR', 2, 'European Euro', 'Euro'), ('USD', 2, 'United States Dollar', 'US Dollar'), ('INR', 2, 'Indian Rupee', 'Rupee'),
              ('GBP', 2, 'British Pound', 'Pound'), ('CHF', 2, 'Swiss Franc', 'Franc'), ('JPY', 0, 'Japanese Yen', 'Yen'), ('CNY', 2, 'Chinese Renminbi', 'Renminbi'),
              ('AUD', 2, 'Australian Dollar', 'Austr. Dollar'), ('CAD', 2, 'Canadian Dollar', 'Canadian Dollar'), ('BRL', 2, 'Brazilian Real', 'Real'),
              ('SGD', 2, 'Singapore Dollar', 'Sing. Dollar'), ('AED', 2, 'UAE Dirham', 'Dirham'), ('MXN', 2, 'Mexican Peso', 'Peso')]
rows('tcurc', *[{'waers': w, 'isocd': w, 'altwr': '', 'xprimary': 'X'} for w, *_ in CURRENCIES])
rows('tcurt', *[{'spras': 'E', 'waers': w, 'ltext': l, 'ktext': k[:15]} for w, _, l, k in CURRENCIES])
rows('tcurx', *[{'currkey': w, 'currdec': d} for w, d, *_ in CURRENCIES if d != 2])
rows('tcurv', {'kurst': 'M', 'xinvr': ''}, {'kurst': 'B', 'xinvr': ''}, {'kurst': 'G', 'xinvr': ''})
rows('tcurw', {'spras': 'E', 'kurst': 'M', 'curvw': 'Standard translation at average rate'}, {'spras': 'E', 'kurst': 'B', 'curvw': 'Standard translation at bank selling rate'},
     {'spras': 'E', 'kurst': 'G', 'curvw': 'Standard translation at bank buying rate'})
EUR_RATES = {'USD': 1.08, 'INR': 90.1, 'GBP': 0.85, 'CHF': 0.95, 'JPY': 163.0, 'CNY': 7.8, 'AUD': 1.65, 'CAD': 1.48, 'BRL': 6.0, 'SGD': 1.45, 'AED': 3.97, 'MXN': 21.5}
for d in ('20260101', '20261001'):
    f = 1.0 if d == '20260101' else 1.01
    for w, r in EUR_RATES.items():
        rows('tcurr', {'kurst': 'M', 'fcurr': 'EUR', 'tcurr': w, 'gdatu': d, 'ukurs': round(r * f, 5), 'ffact': 1, 'tfact': 1})
        rows('tcurr', {'kurst': 'M', 'fcurr': w, 'tcurr': 'EUR', 'gdatu': d, 'ukurs': round(1 / (r * f), 5), 'ffact': 1, 'tfact': 1})
    rows('tcurr', {'kurst': 'M', 'fcurr': 'USD', 'tcurr': 'INR', 'gdatu': d, 'ukurs': round(EUR_RATES['INR'] / EUR_RATES['USD'] * f, 5), 'ffact': 1, 'tfact': 1})
UOMS = [('EA', 'AAAADL', 'EA', 0, 'ea', 'Each'), ('PC', 'AAAADL', 'H87', 0, 'pc', 'Piece'), ('KG', 'MASS', 'KGM', 3, 'kg', 'Kilogram'), ('G', 'MASS', 'GRM', 3, 'g', 'Gram'),
        ('TO', 'MASS', 'TNE', 3, 't', 'Ton'), ('L', 'VOLUME', 'LTR', 3, 'l', 'Liter'), ('ML', 'VOLUME', 'MLT', 3, 'ml', 'Milliliter'), ('M3', 'VOLUME', 'MTQ', 3, 'm3', 'Cubic meter'),
        ('M', 'LENGTH', 'MTR', 3, 'm', 'Meter'), ('CM', 'LENGTH', 'CMT', 3, 'cm', 'Centimeter'), ('MM', 'LENGTH', 'MMT', 3, 'mm', 'Millimeter'), ('M2', 'SURFAC', 'MTK', 3, 'm2', 'Square meter'),
        ('H', 'TIME', 'HUR', 2, 'h', 'Hour'), ('MIN', 'TIME', 'MIN', 0, 'min', 'Minute'), ('DAY', 'TIME', 'DAY', 0, 'day', 'Day'),
        ('BOX', 'AAAADL', 'BX', 0, 'box', 'Box'), ('CS', 'AAAADL', 'CS', 0, 'cs', 'Case'), ('PAL', 'AAAADL', 'PF', 0, 'pal', 'Pallet'), ('PAA', 'AAAADL', 'PR', 0, 'pr', 'Pair')]
rows('t006', *[{'msehi': u, 'dimid': dim, 'isocode': iso, 'andec': dec, 'primary': 'X'} for u, dim, iso, dec, _, _ in UOMS])
rows('t006a', *[{'spras': 'E', 'msehi': u, 'mseh3': u[:3], 'mseh6': s, 'msehl': l} for u, _, _, _, s, l in UOMS])
rows('t004', {'ktopl': 'YCOA', 'dspra': 'E', 'saknr_len': '10'})
rows('t004t', {'spras': 'E', 'ktopl': 'YCOA', 'ktplt': 'Standard chart of accounts'})
rows('t009', {'periv': 'K4', 'anzbp': '012', 'anzsp': '04'}, {'periv': 'V3', 'anzbp': '012', 'anzsp': '04'})
rows('t009t', {'spras': 'E', 'periv': 'K4', 'ltext': 'Calendar year, 4 special periods'}, {'spras': 'E', 'periv': 'V3', 'ltext': 'April - March, 4 special periods'})
COMPANIES = [  # company code, name, city, country, currency, language, fiscal year variant, plant city, street, postcode, region
    ('1010', 'Company Code 1010', 'Berlin', 'DE', 'EUR', 'D', 'K4', 'Hamburg', 'Hafenstraße 12', '20457', 'HH'),
    ('1710', 'Company Code 1710', 'Palo Alto', 'US', 'USD', 'E', 'K4', 'Palo Alto', '3410 Hillview Ave', '94304', 'CA'),
    ('4110', 'Company Code 4110', 'Bengaluru', 'IN', 'INR', 'E', 'V3', 'Pune', 'Plot 14, Hinjewadi Phase 2', '411057', '13')]
rows('t880', *[{'rcomp': cc, 'name1': f'Company {cc}', 'cntry': c, 'curr': w} for cc, _, _, c, w, *_ in COMPANIES])
rows('t001', *[{'bukrs': cc, 'butxt': n, 'ort01': city, 'land1': c, 'waers': w, 'spras': l, 'ktopl': 'YCOA', 'periv': fy, 'rcomp': cc, 'adrnr': '', 'stceg': f'{c}{cc}9988776'}
               for cc, n, city, c, w, l, fy, *_ in COMPANIES])
rows('tka01', {'kokrs': 'A000', 'bezei': 'Controlling Area A000', 'waers': 'EUR', 'ktopl': 'YCOA', 'lmona': '12'})
rows('tka02', *[{'bukrs': cc, 'kokrs': 'A000'} for cc, *_ in COMPANIES])
rows('t001k', *[{'bwkey': cc, 'bukrs': cc} for cc, *_ in COMPANIES])
rows('t001w', *[{'werks': cc, 'name1': f'Plant {cc} {pc}', 'bwkey': cc, 'kunnr': '', 'lifnr': '', 'fabkl': c[:2], 'stras': st, 'pstlz': pz, 'ort01': pc, 'land1': c,
                 'regio': rg, 'ekorg': cc, 'vkorg': cc, 'vtweg': '10', 'spart': '00', 'spras': l, 'adrnr': '', 'vlfkz': 'A'}
                for cc, _, _, c, _, l, _, pc, st, pz, rg in COMPANIES])
rows('t001l', *[r for cc, *_ in COMPANIES for r in ({'werks': cc, 'lgort': cc[:3] + 'A', 'lgobe': 'Std. storage 1', 'vkorg': cc, 'vtweg': '10'},
                                                     {'werks': cc, 'lgort': cc[:3] + 'B', 'lgobe': 'Std. storage 2', 'vkorg': cc, 'vtweg': '10'},
                                                     {'werks': cc, 'lgort': cc[:3] + 'Q', 'lgobe': 'Quality inspection', 'vkorg': '', 'vtweg': ''})])
rows('tvko', *[{'vkorg': cc, 'waers': w, 'bukrs': cc, 'kunnr': ''} for cc, _, _, _, w, *_ in COMPANIES])
rows('tvkot', *[{'spras': 'E', 'vkorg': cc, 'vtext': f'Dom. Sales Org {c}'} for cc, _, _, c, *_ in COMPANIES])
rows('tvtw', {'vtweg': '10'}, {'vtweg': '20'}, {'vtweg': '30'})
rows('tvtwt', {'spras': 'E', 'vtweg': '10', 'vtext': 'Direct sales'}, {'spras': 'E', 'vtweg': '20', 'vtext': 'Retail sales'}, {'spras': 'E', 'vtweg': '30', 'vtext': 'Online sales'})
rows('tspa', {'spart': '00'}, {'spart': '10'}, {'spart': '20'})
rows('tspat', {'spras': 'E', 'spart': '00', 'vtext': 'Product division 00'}, {'spras': 'E', 'spart': '10', 'vtext': 'Electronics'}, {'spras': 'E', 'spart': '20', 'vtext': 'Accessories'})
rows('tvta', *[{'vkorg': cc, 'vtweg': v, 'spart': s} for cc, *_ in COMPANIES for v in ('10', '20', '30') for s in ('00', '10', '20')])
rows('t024e', *[{'ekorg': cc, 'ekotx': f'Purch. Org. {cc}', 'bukrs': cc} for cc, *_ in COMPANIES])
rows('t024', {'ekgrp': '001', 'eknam': 'Group 001 IT', 'tel_number': '+49 30 1234 100', 'smtp_addr': 'purchasing.it@example.com'},
     {'ekgrp': '002', 'eknam': 'Group 002 Office', 'tel_number': '+49 30 1234 200', 'smtp_addr': 'purchasing.office@example.com'},
     {'ekgrp': '003', 'eknam': 'Group 003 Production', 'tel_number': '+1 650 555 0300', 'smtp_addr': 'purchasing.production@example.com'})
TERMS = [('0001', 0, 0, 0, 0, 0, 'Pay immediately w/o deduction'), ('0002', 14, 2, 30, 0, 0, 'Within 14 days 2% cash discount, 30 days net'),
         ('NT30', 30, 0, 0, 0, 0, 'Within 30 days due net'), ('NT45', 45, 0, 0, 0, 0, 'Within 45 days due net'), ('NT60', 60, 0, 0, 0, 0, 'Within 60 days due net')]
rows('t052', *[{'zterm': z, 'ztag1': f'{a:03d}', 'zprz1': p, 'ztag2': f'{b:03d}', 'zprz2': q, 'ztag3': '000'} for z, a, p, b, q, _, _ in TERMS])
rows('tvzbt', *[{'spras': 'E', 'zterm': z, 'vtext': t[:30]} for z, *_, t in TERMS])
INCO = [('EXW', 'Ex Works'), ('FCA', 'Free Carrier'), ('CPT', 'Carriage Paid To'), ('CIP', 'Carriage and Insurance Paid To'), ('DAP', 'Delivered at Place'),
        ('DPU', 'Delivered at Place Unloaded'), ('DDP', 'Delivered Duty Paid'), ('FAS', 'Free Alongside Ship'), ('FOB', 'Free on Board'), ('CFR', 'Cost and Freight'),
        ('CIF', 'Cost, Insurance and Freight')]
rows('tinc', *[{'inco1': i, 'ortob': 'X'} for i, _ in INCO])
rows('tinct', *[{'spras': 'E', 'inco1': i, 'bezei': t} for i, t in INCO])
rows('tvsb', {'vsbed': '01'}, {'vsbed': '02'}, {'vsbed': '03'})
rows('tvsbt', {'spras': 'E', 'vsbed': '01', 'vtext': 'Standard'}, {'spras': 'E', 'vsbed': '02', 'vtext': 'Express'}, {'spras': 'E', 'vsbed': '03', 'vtext': 'Pick up'})
PTYPES = [('FERT', 'Finished Product'), ('HAWA', 'Trading Goods'), ('ROH', 'Raw Material'), ('HALB', 'Semifinished Product'), ('DIEN', 'Service'), ('VERP', 'Packaging')]
rows('t134', *[{'mtart': t, 'mtref': t, 'kkref': '0001'} for t, _ in PTYPES])
rows('t134t', *[{'spras': 'E', 'mtart': t, 'mtbez': n} for t, n in PTYPES])
PGROUPS = [('L001', 'Laptops & notebooks'), ('L002', 'Monitors & displays'), ('L003', 'Accessories'), ('L004', 'Office supplies'), ('L005', 'Electronic components'),
           ('L006', 'Packaging material'), ('L007', 'IT services')]
rows('t023', *[{'matkl': g, 'begru': ''} for g, _ in PGROUPS])
rows('t023t', *[{'spras': 'E', 'matkl': g, 'wgbez': n[:20], 'wgbez60': n} for g, n in PGROUPS])
rows('t438a', {'dismm': 'PD', 'disvf': 'B'}, {'dismm': 'VB', 'disvf': 'V'}, {'dismm': 'ND', 'disvf': ''})
rows('t438t', {'spras': 'E', 'dismm': 'PD', 'dibez': 'MRP'}, {'spras': 'E', 'dismm': 'VB', 'dibez': 'Manual reorder point planning'}, {'spras': 'E', 'dismm': 'ND', 'dibez': 'No planning'})
rows('t077d', {'ktokd': 'CUST', 'numkr': '01'}, {'ktokd': 'CPD', 'numkr': '02'})
rows('t077x', {'spras': 'E', 'ktokd': 'CUST', 'txt30': 'Customer'}, {'spras': 'E', 'ktokd': 'CPD', 'txt30': 'One-time customer'})
rows('t077k', {'ktokk': 'SUPL', 'numkr': '01'}, {'ktokk': 'CPDL', 'numkr': '02'})
rows('t077y', {'spras': 'E', 'ktokk': 'SUPL', 'txt30': 'Supplier'}, {'spras': 'E', 'ktokk': 'CPDL', 'txt30': 'One-time supplier'})
rows('tb001', {'bu_group': 'BP02', 'nrrng': '02'}, {'bu_group': 'BP03', 'nrrng': '03'}, {'bu_group': 'BP01', 'nrrng': '01'})
rows('tb002', {'spras': 'E', 'bu_group': 'BP02', 'txt40': 'Customer (int.no.assgnmt)'}, {'spras': 'E', 'bu_group': 'BP03', 'txt40': 'Supplier (int.no.assgnmt)'},
     {'spras': 'E', 'bu_group': 'BP01', 'txt40': 'Business partner (int.no.assgnmt)'})
rows('tb003', {'role': '000000'}, {'role': 'FLCU00'}, {'role': 'FLCU01'}, {'role': 'FLVN00'}, {'role': 'FLVN01'})
rows('tb003t', {'spras': 'E', 'role': '000000', 'rltitl': 'Business Partner (Gen.)'}, {'spras': 'E', 'role': 'FLCU00', 'rltitl': 'FI Customer'},
     {'spras': 'E', 'role': 'FLCU01', 'rltitl': 'Customer'}, {'spras': 'E', 'role': 'FLVN00', 'rltitl': 'FI Vendor'}, {'spras': 'E', 'role': 'FLVN01', 'rltitl': 'Supplier'})
GLGROUPS = [('BS', 'Balance sheet accounts'), ('PL', 'Profit and loss accounts'), ('REC', 'Reconciliation accounts')]
rows('t077s', *[{'ktopl': 'YCOA', 'ktoks': g} for g, _ in GLGROUPS])
rows('t077z', *[{'spras': 'E', 'ktopl': 'YCOA', 'ktoks': g, 'txt30': t} for g, t in GLGROUPS])

# G/L accounts: number, short text, long text, balance sheet?, P&L type, group, type (X balance sheet, N non-operating, P primary costs, S secondary, C cash)
GL = [('0010010000', 'Bank 1', 'Bank 1 - Main account', 'X', '', 'BS', 'C'), ('0012100000', 'Receivables', 'Receivables domestic', 'X', '', 'REC', 'X'),
      ('0013100000', 'Inventory trading', 'Inventory - trading goods', 'X', '', 'BS', 'X'), ('0013200000', 'Inventory finished', 'Inventory - finished goods', 'X', '', 'BS', 'X'),
      ('0016100000', 'Input tax', 'Input tax', 'X', '', 'BS', 'X'), ('0021100000', 'Payables', 'Payables domestic', 'X', '', 'REC', 'X'),
      ('0021500000', 'GR/IR clearing', 'GR/IR clearing - own production', 'X', '', 'BS', 'X'), ('0022000000', 'Output tax', 'Output tax', 'X', '', 'BS', 'X'),
      ('0041000000', 'Revenue domestic', 'Revenue domestic - product', 'X', 'X', 'PL', 'P'), ('0041000100', 'Revenue foreign', 'Revenue foreign - product', '', 'X', 'PL', 'P'),
      ('0050000100', 'COGS', 'Cost of goods sold', '', 'X', 'PL', 'P'), ('0061000000', 'Office supplies', 'Office supplies expense', '', 'X', 'PL', 'P'),
      ('0061003000', 'IT services', 'IT services expense', '', 'X', 'PL', 'P'), ('0063000000', 'Salaries', 'Salaries and wages', '', 'X', 'PL', 'P'),
      ('0065000000', 'Rent', 'Rent and leases', '', 'X', 'PL', 'P'), ('0065300000', 'Travel', 'Travel expenses', '', 'X', 'PL', 'P')]
rows('ska1', *[{'ktopl': 'YCOA', 'saknr': a, 'xbilk': 'X' if g in ('BS', 'REC') else '', 'gvtyp': 'X' if g == 'PL' else '', 'ktoks': g, 'glaccount_type': t} for a, _, _, _, _, g, t in GL])
rows('skat', *[{'spras': 'E', 'ktopl': 'YCOA', 'saknr': a, 'txt20': s, 'txt50': l} for a, s, l, *_ in GL])
rows('skb1', *[{'bukrs': cc, 'saknr': a, 'waers': w, 'mitkz': 'D' if a == '0012100000' else 'K' if a == '0021100000' else '', 'xspeb': '', 'xopvw': 'X' if g == 'REC' else ''}
               for cc, _, _, _, w, *_ in COMPANIES for a, _, _, _, _, g, _ in GL])
PCS = [('YB101', 'Sales', 'Sales and distribution', 'Anna Weber'), ('YB102', 'Products', 'Product line laptops', 'Ravi Kumar'),
       ('YB103', 'Services', 'Professional services', 'Laura Smith'), ('YB900', 'Admin', 'Administration', 'Peter Braun')]
rows('cepc', *[{'prctr': p, 'datbi': '99991231', 'kokrs': 'A000', 'datab': '20200101', 'bukrs': '', 'verak': who, 'segment': '1000_C'} for p, _, _, who in PCS])
rows('cepct', *[{'spras': 'E', 'prctr': p, 'datbi': '99991231', 'kokrs': 'A000', 'ktext': s, 'ltext': l} for p, s, l, _ in PCS])
CCS = [('10101101', '1010', 'YB101', 'E', 'Sales DE', 'Sales Germany', 'Anna Weber', 'EUR'), ('10101201', '1010', 'YB900', 'W', 'Admin DE', 'Administration Germany', 'Peter Braun', 'EUR'),
       ('10101301', '1010', 'YB102', 'F', 'Production DE', 'Production Hamburg', 'Klaus Meier', 'EUR'), ('17101101', '1710', 'YB101', 'E', 'Sales US', 'Sales United States', 'Laura Smith', 'USD'),
       ('17101201', '1710', 'YB900', 'W', 'Admin US', 'Administration United States', 'John Miller', 'USD'), ('41101101', '4110', 'YB101', 'E', 'Sales IN', 'Sales India', 'Priya Sharma', 'INR'),
       ('41101301', '4110', 'YB103', 'L', 'Services IN', 'Professional services India', 'Ravi Kumar', 'INR')]
rows('csks', *[{'kokrs': 'A000', 'kostl': k, 'datbi': '99991231', 'datab': '20200101', 'bukrs': cc, 'prctr': p, 'kosar': cat, 'verak': who, 'waers': w} for k, cc, p, cat, _, _, who, w in CCS])
rows('cskt', *[{'spras': 'E', 'kokrs': 'A000', 'kostl': k, 'datbi': '99991231', 'ktext': s, 'ltext': l} for k, _, _, _, s, l, _, _ in CCS])
rows('bnka', {'banks': 'DE', 'bankl': '10070000', 'banka': 'Deutsche Bank Berlin', 'ort01': 'Berlin', 'stras': 'Otto-Suhr-Allee 6-16', 'swift': 'DEUTDEBBXXX', 'loevm': ''},
     {'banks': 'DE', 'bankl': '20040000', 'banka': 'Commerzbank Hamburg', 'ort01': 'Hamburg', 'stras': 'Ness 7-9', 'swift': 'COBADEHHXXX', 'loevm': ''},
     {'banks': 'US', 'bankl': '121000248', 'banka': 'Wells Fargo Bank', 'ort01': 'San Francisco', 'stras': '420 Montgomery St', 'swift': 'WFBIUS6SXXX', 'loevm': ''},
     {'banks': 'IN', 'bankl': 'HDFC0000001', 'banka': 'HDFC Bank', 'ort01': 'Mumbai', 'stras': 'Senapati Bapat Marg', 'swift': 'HDFCINBBXXX', 'loevm': ''},
     {'banks': 'IN', 'bankl': 'SBIN0000813', 'banka': 'State Bank of India', 'ort01': 'Pune', 'stras': 'Shivajinagar', 'swift': 'SBININBB813', 'loevm': ''})

# business partners: customers (BP = customer number) and suppliers (BP = supplier number), with addresses
CUSTOMERS = [  # number, name, street, number, postcode, city, region, country, phone, email, company code
    ('0010100001', 'Inlandskunde DE 1', 'Lindenstraße', '4', '10969', 'Berlin', 'BE', 'DE', '+49 30 4455 01', 'einkauf@inlandskunde1.example', '1010'),
    ('0010100002', 'Müller Bürobedarf GmbH', 'Königsallee', '27', '40212', 'Düsseldorf', 'NW', 'DE', '+49 211 8899 02', 'orders@mueller-buero.example', '1010'),
    ('0010100003', 'Alpen Elektronik AG', 'Leopoldstraße', '150', '80804', 'München', 'BY', 'DE', '+49 89 5566 03', 'buy@alpen-elektronik.example', '1010'),
    ('0017100001', 'Domestic US Customer 1', 'Market Street', '1 ', '94105', 'San Francisco', 'CA', 'US', '+1 415 555 0101', 'purchasing@domus1.example', '1710'),
    ('0017100002', 'Lone Star Retail Inc.', 'Congress Ave', '600', '78701', 'Austin', 'TX', 'US', '+1 512 555 0102', 'ap@lonestar-retail.example', '1710'),
    ('0017100003', 'Empire Office Supply LLC', 'Broadway', '1500', '10036', 'New York', 'NY', 'US', '+1 212 555 0103', 'orders@empire-office.example', '1710'),
    ('0041100001', 'Domestic IN Customer 1', 'MG Road', '45', '560001', 'Bengaluru', '10', 'IN', '+91 80 4123 0001', 'procure@dominc1.example', '4110'),
    ('0041100002', 'Shree Ganesh Traders', 'FC Road', '12', '411004', 'Pune', '13', 'IN', '+91 20 2567 0002', 'accounts@shreeganesh.example', '4110'),
    ('0041100003', 'Coromandel Systems Pvt Ltd', 'Anna Salai', '221', '600002', 'Chennai', '22', 'IN', '+91 44 2851 0003', 'buying@coromandel.example', '4110'),
    ('0010100004', 'EuroTech Distribution B.V.', 'Keizersgracht', '62', '1015 CS', 'Amsterdam', '', 'NL', '+31 20 555 0104', 'orders@eurotech.example', '1010')]
SUPPLIERS = [
    ('0010300001', 'Inlandslieferant DE 1', 'Am Hafen', '3', '20457', 'Hamburg', 'HH', 'DE', '+49 40 7788 01', 'vertrieb@lieferant1.example', '1010'),
    ('0010300002', 'Schwarzwald Komponenten GmbH', 'Industriestraße', '18', '79098', 'Freiburg', 'BW', 'DE', '+49 761 3344 02', 'sales@sw-komponenten.example', '1010'),
    ('0017300001', 'Domestic US Supplier 1', 'Industrial Pkwy', '200', '94544', 'Hayward', 'CA', 'US', '+1 510 555 0201', 'sales@dussupl1.example', '1710'),
    ('0017300002', 'Great Lakes Packaging Co.', 'Wacker Drive', '333', '60606', 'Chicago', 'IL', 'US', '+1 312 555 0202', 'orders@glpack.example', '1710'),
    ('0041300001', 'Domestic IN Supplier 1', 'Electronic City Phase 1', '7', '560100', 'Bengaluru', '10', 'IN', '+91 80 4900 0001', 'sales@dinsupl1.example', '4110'),
    ('0041300002', 'Mahalaxmi Office Solutions', 'Lower Parel', '88', '400013', 'Mumbai', '13', 'IN', '+91 22 4033 0002', 'sales@mahalaxmi.example', '4110'),
    ('0041300003', 'Infosoft IT Services Ltd', 'Cyber City', '10', '122002', 'Gurugram', '06', 'IN', '+91 124 456 0003', 'contracts@infosoft-it.example', '4110')]
COMPANY = {cc: (w, c) for cc, _, _, c, w, *_ in COMPANIES}
SORT = lambda n: ''.join(ch for ch in n.upper() if ch.isalnum())[:20]
for i, (no, name, st, hn, pz, city, rg, c, tel, mail, cc) in enumerate(CUSTOMERS + SUPPLIERS):
    supplier = (no, name) in [(s[0], s[1]) for s in SUPPLIERS]
    adr = f'{9000000001 + i:010d}'
    w, home = COMPANY[cc]
    rows('adrc', {'addrnumber': adr, 'date_from': '00010101', 'nation': '', 'name1': name, 'name2': '', 'street': st, 'house_num1': hn.strip(), 'post_code1': pz,
                  'city1': city, 'country': c, 'region': rg, 'langu': 'D' if c == 'DE' else 'E', 'tel_number': tel, 'smtp_addr': mail})
    rows('but000', {'partner': no, 'type': '2', 'bu_group': 'BP03' if supplier else 'BP02', 'bu_sort1': SORT(name), 'name_org1': name, 'name_org2': '', 'name_first': '',
                    'name_last': '', 'xblck': '', 'xdele': '', 'crdat': '20260105', 'crusr': 'MIGRATION', 'chdat': '20260105', 'partner_guid': ''})
    rows('but020', {'partner': no, 'addrnumber': adr, 'xdfadr': 'X'})
    for role in (['000000', 'FLVN00', 'FLVN01'] if supplier else ['000000', 'FLCU00', 'FLCU01']):
        rows('but100', {'partner': no, 'rltyp': role, 'dfval': '', 'valid_from': '20260105', 'valid_to': '99991231'})
    common = {'name1': name[:35], 'name2': '', 'ort01': city, 'pstlz': pz, 'stras': f'{st} {hn.strip()}'[:35], 'land1': c, 'regio': rg, 'spras': 'D' if c == 'DE' else 'E',
              'telf1': tel[:16], 'stcd1': '', 'stceg': f'{c}{no[-6:]}123' if c in ('DE', 'NL') else '', 'adrnr': adr, 'loevm': '', 'erdat': '20260105', 'ernam': 'MIGRATION'}
    if supplier:
        rows('lfa1', {'lifnr': no, **common, 'ktokk': 'SUPL', 'sperr': '', 'kunnr': ''})
        rows('lfb1', {'lifnr': no, 'bukrs': cc, 'akont': '0021100000', 'zterm': 'NT30', 'loevm': ''})
        rows('lfm1', {'lifnr': no, 'ekorg': cc, 'waers': w, 'zterm': 'NT30', 'inco1': 'FCA' if c == home else 'DAP', 'inco2': city, 'webre': 'X',
                      'verkf': 'Sales desk', 'telf1': tel[:16], 'loevm': ''})
    else:
        rows('kna1', {'kunnr': no, **common, 'ktokd': 'CUST', 'aufsd': '', 'lifnr': ''})
        rows('knb1', {'kunnr': no, 'bukrs': cc, 'akont': '0012100000', 'zterm': '0002' if c == 'DE' else 'NT30', 'busab': '01', 'loevm': ''})
        for vtweg in ('10', '20'):
            rows('knvv', {'kunnr': no, 'vkorg': cc, 'vtweg': vtweg, 'spart': '00', 'waers': w if c == home else 'EUR', 'zterm': 'NT30', 'inco1': 'EXW' if c == home else 'DAP',
                          'inco2': city, 'vsbed': '01', 'konda': '01', 'kalks': '1', 'aufsd': '', 'loevm': ''})
# two people as business partners (contact persons / consumers)
for no, first, last in (('0000900001', 'Anna', 'Weber'), ('0000900002', 'Ravi', 'Kumar')):
    rows('but000', {'partner': no, 'type': '1', 'bu_group': 'BP01', 'bu_sort1': last.upper(), 'name_org1': '', 'name_org2': '', 'name_first': first, 'name_last': last,
                    'xblck': '', 'xdele': '', 'crdat': '20260105', 'crusr': 'MIGRATION', 'chdat': '20260105', 'partner_guid': ''})
    rows('but100', {'partner': no, 'rltyp': '000000', 'dfval': '', 'valid_from': '20260105', 'valid_to': '99991231'})

# products: number, type, group, base unit, weight kg, description EN, description DE, price EUR, procurement (E in-house, F external), MRP type
PRODUCTS = [
    ('TG11', 'HAWA', 'L001', 'PC', 1.6, 'Laptop Pro 14', 'Laptop Pro 14', 1150.00, 'F', 'PD'),
    ('TG12', 'HAWA', 'L001', 'PC', 2.1, 'Laptop Workstation 16', 'Laptop Workstation 16', 1890.00, 'F', 'PD'),
    ('TG13', 'HAWA', 'L002', 'PC', 5.4, 'Monitor 27" 4K', 'Monitor 27 Zoll 4K', 389.00, 'F', 'VB'),
    ('TG14', 'HAWA', 'L002', 'PC', 7.9, 'Monitor 34" Curved', 'Monitor 34 Zoll Curved', 629.00, 'F', 'VB'),
    ('TG15', 'HAWA', 'L003', 'PC', 0.1, 'Wireless Mouse', 'Kabellose Maus', 24.90, 'F', 'VB'),
    ('TG16', 'HAWA', 'L003', 'PC', 0.7, 'Mechanical Keyboard', 'Mechanische Tastatur', 89.00, 'F', 'VB'),
    ('TG17', 'HAWA', 'L003', 'PC', 0.3, 'USB-C Docking Station', 'USB-C Dockingstation', 149.00, 'F', 'VB'),
    ('TG18', 'HAWA', 'L003', 'PC', 0.2, 'Noise Cancelling Headset', 'Headset mit Geräuschunterdrückung', 119.00, 'F', 'VB'),
    ('FG126', 'FERT', 'L001', 'PC', 1.9, 'Rugged Field Tablet', 'Robustes Feld-Tablet', 980.00, 'E', 'PD'),
    ('SG23', 'HALB', 'L005', 'PC', 0.4, 'Mainboard Assembly', 'Mainboard-Baugruppe', 210.00, 'E', 'PD'),
    ('RM12', 'ROH', 'L005', 'PC', 0.05, 'Memory Module 16 GB', 'Speichermodul 16 GB', 38.00, 'F', 'PD'),
    ('RM13', 'ROH', 'L005', 'PC', 0.08, 'SSD 1 TB', 'SSD 1 TB', 64.00, 'F', 'PD'),
    ('OS01', 'HAWA', 'L004', 'BOX', 2.5, 'Copy Paper A4 (box of 5 reams)', 'Kopierpapier A4 (Karton, 5 Pakete)', 22.50, 'F', 'VB'),
    ('PK01', 'VERP', 'L006', 'PC', 0.6, 'Shipping Carton Large', 'Versandkarton groß', 1.80, 'F', 'VB'),
    ('SV01', 'DIEN', 'L007', 'H', 0.0, 'On-site IT Support (hour)', 'IT-Support vor Ort (Stunde)', 95.00, 'F', 'ND')]
for i, (p, t, g, u, kg, en, de, price, proc, mrp) in enumerate(PRODUCTS):
    rows('mara', {'matnr': p, 'mtart': t, 'matkl': g, 'meins': u, 'brgew': kg, 'ntgew': round(kg * 0.9, 3), 'gewei': 'KG' if kg else '', 'volum': 0, 'voleh': '',
                  'spart': '10' if g in ('L001', 'L002') else '20' if g == 'L003' else '00', 'bismt': '', 'ean11': f'4006381{333930 + i:06d}' if t in ('HAWA', 'FERT') else '',
                  'mstae': '', 'lvorm': '', 'ersda': '20260105', 'ernam': 'MIGRATION', 'laeda': '20260105'})
    rows('makt', {'matnr': p, 'spras': 'E', 'maktx': en[:40]}, {'matnr': p, 'spras': 'D', 'maktx': de[:40]})
    if u == 'BOX': rows('marm', {'matnr': p, 'meinh': 'BOX', 'umrez': 1, 'umren': 1, 'ean11': ''}, {'matnr': p, 'meinh': 'PAL', 'umrez': 40, 'umren': 1, 'ean11': ''})
    else: rows('marm', {'matnr': p, 'meinh': u, 'umrez': 1, 'umren': 1, 'ean11': ''})
    if t in ('HAWA', 'FERT'): rows('marm', {'matnr': p, 'meinh': 'CS', 'umrez': 10 if price < 200 else 4, 'umren': 1, 'ean11': ''})
    for cc, _, _, c, w, *_ in COMPANIES:
        fx = 1 if w == 'EUR' else EUR_RATES[w]
        rows('marc', {'matnr': p, 'werks': cc, 'ekgrp': '003' if t in ('ROH', 'HALB', 'FERT', 'VERP') else '002' if g == 'L004' else '001', 'dismm': mrp, 'dispo': '001',
                      'beskz': proc, 'plifz': 10 if proc == 'F' else 0, 'minbe': 5 if mrp == 'VB' else 0, 'eisbe': 2 if mrp == 'PD' else 0, 'prctr': 'YB103' if t == 'DIEN' else 'YB102',
                      'mmsta': '', 'lvorm': ''})
        if t != 'DIEN':
            for lg, qty in ((cc[:3] + 'A', 20 + (i * 7) % 60), (cc[:3] + 'B', (i * 5) % 25)):
                rows('mard', {'matnr': p, 'werks': cc, 'lgort': lg, 'labst': qty, 'insme': 0, 'speme': 0, 'lgpbe': f'R{i % 9 + 1}-{(i * 3) % 20 + 1:02d}', 'lvorm': ''})
            stock = (20 + (i * 7) % 60) + (i * 5) % 25
            cost = round(price * 0.62 * fx, 2)
            rows('mbew', {'matnr': p, 'bwkey': cc, 'bwtar': '', 'vprsv': 'S' if t in ('FERT', 'HALB') else 'V', 'verpr': cost, 'stprs': cost, 'peinh': 1,
                          'bklas': {'HAWA': '3100', 'FERT': '7920', 'HALB': '7900', 'ROH': '3000', 'VERP': '3050'}[t], 'waers': w, 'lbkum': stock, 'salk3': round(cost * stock, 2)})
        if t in ('HAWA', 'FERT', 'DIEN'):
            for vtweg in ('10', '20'):
                rows('mvke', {'matnr': p, 'vkorg': cc, 'vtweg': vtweg, 'dwerk': cc, 'vrkme': u, 'aumng': 1, 'mtpos': 'NORM' if t != 'DIEN' else 'LEIS', 'lvorm': ''})

# ------------------------------------------------------------------ released CDS views (virtual data model)
VIEWS = []   # (name, label, source, [(expression, alias, key)], extra lines, data category)
def view(name, label, source, cols, assocs=(), where=None, text=False):
    VIEWS.append((name, label, source, cols, assocs, where, text))
def k(e, a): return (e, a, True)
def f(e, a): return (e, a, False)
TXT = lambda v, on: (f'association [0..*] to {v} as _Text on {on}',)

view('I_Language', 'Language', 't002', [k('spras', 'Language'), f('laiso', 'LanguageISOCode')], TXT('I_LanguageText', '$projection.Language = _Text.Language'))
view('I_TimeZone', 'Time Zone', 'ttzz', [k('tzone', 'TimeZoneID'), f('zonerule', 'TimeZoneRule'), f('dstrule', 'DaylightSavingTimeRule'), f('flagactive', 'TimeZoneIsActive')], TXT('I_TimeZoneText', '$projection.TimeZoneID = _Text.TimeZoneID'))
view('I_TimeZoneText', 'Time Zone - Text', 'ttzzt', [k('tzone', 'TimeZoneID'), k('langu', 'Language'), f('descript', 'TimeZoneText')], text=True)
view('I_LanguageText', 'Language - Text', 't002t', [k('sprsl', 'Language'), k('spras', 'LanguageCode'), f('sptxt', 'LanguageName')], text=True)
view('I_Country', 'Country', 't005', [k('land1', 'Country'), f('intca', 'CountryISOCode'), f('intca3', 'CountryThreeLetterISOCode'), f('intcn3', 'CountryThreeDigitISOCode'),
     f('waers', 'CountryCurrency'), f('xegld', 'IsEuropeanUnionMember')], TXT('I_CountryText', '$projection.Country = _Text.Country'))
view('I_CountryText', 'Country - Text', 't005t', [k('land1', 'Country'), k('spras', 'Language'), f('landx50', 'CountryName'), f('landx', 'CountryShortName'), f('natio', 'NationalityName')], text=True)
view('I_Region', 'Region', 't005s', [k('land1', 'Country'), k('bland', 'Region')], TXT('I_RegionText', '$projection.Country = _Text.Country and $projection.Region = _Text.Region'))
view('I_RegionText', 'Region - Text', 't005u', [k('land1', 'Country'), k('bland', 'Region'), k('spras', 'Language'), f('bezei', 'RegionName')], text=True)
view('I_Currency', 'Currency', 'tcurc', [k('waers', 'Currency'), f('isocd', 'CurrencyISOCode'), f('altwr', 'AlternativeCurrencyKey'), f('xprimary', 'IsPrimaryCurrencyForISOCrcy')],
     TXT('I_CurrencyText', '$projection.Currency = _Text.Currency'))
view('I_CurrencyText', 'Currency - Text', 'tcurt', [k('waers', 'Currency'), k('spras', 'Language'), f('ltext', 'CurrencyName'), f('ktext', 'CurrencyShortName')], text=True)
view('I_ExchangeRateType', 'Exchange Rate Type', 'tcurv', [k('kurst', 'ExchangeRateType'), f('xinvr', 'ExchRateIsInvertedQuotation')], TXT('I_ExchangeRateTypeText', '$projection.ExchangeRateType = _Text.ExchangeRateType'))
view('I_ExchangeRateTypeText', 'Exchange Rate Type - Text', 'tcurw', [k('kurst', 'ExchangeRateType'), k('spras', 'Language'), f('curvw', 'ExchangeRateTypeName')], text=True)
view('I_ExchangeRateRawData', 'Exchange Rate', 'tcurr', [k('kurst', 'ExchangeRateType'), k('fcurr', 'SourceCurrency'), k('tcurr', 'TargetCurrency'), k('gdatu', 'ValidityStartDate'),
     f('ukurs', 'ExchangeRate'), f('ffact', 'NumberOfSourceCurrencyUnits'), f('tfact', 'NumberOfTargetCurrencyUnits')])
view('I_UnitOfMeasure', 'Unit of Measure', 't006', [k('msehi', 'UnitOfMeasure'), f('msehi', 'UnitOfMeasureSAPCode'), f('isocode', 'UnitOfMeasureISOCode'), f('dimid', 'UnitOfMeasureDimension'),
     f('andec', 'UnitOfMeasureNumberOfDecimals'), f('primary', 'IsPrimaryUnitForISOCode')], TXT('I_UnitOfMeasureText', '$projection.UnitOfMeasure = _Text.UnitOfMeasure'))
view('I_UnitOfMeasureText', 'Unit of Measure - Text', 't006a', [k('msehi', 'UnitOfMeasure'), k('spras', 'Language'), f('mseh6', 'UnitOfMeasureName'), f('msehl', 'UnitOfMeasureLongName'),
     f('mseh3', 'UnitOfMeasureCommercialName')], text=True)
view('I_ChartOfAccounts', 'Chart of Accounts', 't004', [k('ktopl', 'ChartOfAccounts'), f('dspra', 'MaintenanceLanguage'), f('saknr_len', 'GLAccountLength')],
     TXT('I_ChartOfAccountsText', '$projection.ChartOfAccounts = _Text.ChartOfAccounts'))
view('I_ChartOfAccountsText', 'Chart of Accounts - Text', 't004t', [k('ktopl', 'ChartOfAccounts'), k('spras', 'Language'), f('ktplt', 'ChartOfAccountsName')], text=True)
view('I_FiscalYearVariant', 'Fiscal Year Variant', 't009', [k('periv', 'FiscalYearVariant'), f('anzbp', 'NumberOfPostingPeriods'), f('anzsp', 'NumberOfSpecialPeriods')],
     TXT('I_FiscalYearVariantText', '$projection.FiscalYearVariant = _Text.FiscalYearVariant'))
view('I_FiscalYearVariantText', 'Fiscal Year Variant - Text', 't009t', [k('periv', 'FiscalYearVariant'), k('spras', 'Language'), f('ltext', 'FiscalYearVariantName')], text=True)
view('I_CompanyCode', 'Company Code', 't001', [k('bukrs', 'CompanyCode'), f('butxt', 'CompanyCodeName'), f('ort01', 'CityName'), f('land1', 'Country'), f('waers', 'Currency'),
     f('spras', 'Language'), f('ktopl', 'ChartOfAccounts'), f('periv', 'FiscalYearVariant'), f('rcomp', 'Company'), f('stceg', 'VATRegistration')],
     ('association [0..1] to I_Country as _Country on $projection.Country = _Country.Country', 'association [0..1] to I_Currency as _Currency on $projection.Currency = _Currency.Currency',
      'association [0..1] to I_ChartOfAccounts as _ChartOfAccounts on $projection.ChartOfAccounts = _ChartOfAccounts.ChartOfAccounts'))
view('I_ControllingArea', 'Controlling Area', 'tka01', [k('kokrs', 'ControllingArea'), f('bezei', 'ControllingAreaName'), f('waers', 'ControllingAreaCurrency'), f('ktopl', 'ChartOfAccounts'),
     f('lmona', 'NumberOfPostingPeriods')])
view('I_ValuationArea', 'Valuation Area', 't001k', [k('bwkey', 'ValuationArea'), f('bukrs', 'CompanyCode')])
view('I_Plant', 'Plant', 't001w', [k('werks', 'Plant'), f('name1', 'PlantName'), f('bwkey', 'ValuationArea'), f('kunnr', 'PlantCustomer'), f('lifnr', 'PlantSupplier'),
     f('fabkl', 'FactoryCalendar'), f('ekorg', 'DefaultPurchasingOrganization'), f('vkorg', 'SalesOrganization'), f('vtweg', 'DistributionChannel'), f('spart', 'Division'),
     f('spras', 'Language'), f('adrnr', 'AddressID'), f('vlfkz', 'PlantCategory'), f('ort01', 'CityName'), f('land1', 'Country'), f('regio', 'Region'), f('pstlz', 'PostalCode'),
     f('stras', 'StreetName')], ('association [0..1] to I_ValuationArea as _ValuationArea on $projection.ValuationArea = _ValuationArea.ValuationArea',))
view('I_StorageLocation', 'Storage Location', 't001l', [k('werks', 'Plant'), k('lgort', 'StorageLocation'), f('lgobe', 'StorageLocationName'), f('vkorg', 'SalesOrganization'),
     f('vtweg', 'DistributionChannel')], ('association [1..1] to I_Plant as _Plant on $projection.Plant = _Plant.Plant',))
view('I_SalesOrganization', 'Sales Organization', 'tvko', [k('vkorg', 'SalesOrganization'), f('waers', 'SalesOrganizationCurrency'), f('bukrs', 'CompanyCode'),
     f('kunnr', 'IntercompanyBillingCustomer')], TXT('I_SalesOrganizationText', '$projection.SalesOrganization = _Text.SalesOrganization'))
view('I_SalesOrganizationText', 'Sales Organization - Text', 'tvkot', [k('vkorg', 'SalesOrganization'), k('spras', 'Language'), f('vtext', 'SalesOrganizationName')], text=True)
view('I_DistributionChannel', 'Distribution Channel', 'tvtw', [k('vtweg', 'DistributionChannel')], TXT('I_DistributionChannelText', '$projection.DistributionChannel = _Text.DistributionChannel'))
view('I_DistributionChannelText', 'Distribution Channel - Text', 'tvtwt', [k('vtweg', 'DistributionChannel'), k('spras', 'Language'), f('vtext', 'DistributionChannelName')], text=True)
view('I_Division', 'Division', 'tspa', [k('spart', 'Division')], TXT('I_DivisionText', '$projection.Division = _Text.Division'))
view('I_DivisionText', 'Division - Text', 'tspat', [k('spart', 'Division'), k('spras', 'Language'), f('vtext', 'DivisionName')], text=True)
view('I_SalesArea', 'Sales Area', 'tvta', [k('vkorg', 'SalesOrganization'), k('vtweg', 'DistributionChannel'), k('spart', 'Division')])
view('I_PurchasingOrganization', 'Purchasing Organization', 't024e', [k('ekorg', 'PurchasingOrganization'), f('ekotx', 'PurchasingOrganizationName'), f('bukrs', 'CompanyCode')])
view('I_PurchasingGroup', 'Purchasing Group', 't024', [k('ekgrp', 'PurchasingGroup'), f('eknam', 'PurchasingGroupName'), f('tel_number', 'PurchasingGroupPhoneNumber'),
     f('smtp_addr', 'EmailAddress')])
view('I_PaymentTerms', 'Payment Terms', 't052', [k('zterm', 'PaymentTerms'), f('ztag1', 'CashDiscount1Days'), f('zprz1', 'CashDiscount1Percent'), f('ztag2', 'CashDiscount2Days'),
     f('zprz2', 'CashDiscount2Percent'), f('ztag3', 'NetPaymentDays')], TXT('I_PaymentTermsText', '$projection.PaymentTerms = _Text.PaymentTerms'))
view('I_PaymentTermsText', 'Payment Terms - Text', 'tvzbt', [k('zterm', 'PaymentTerms'), k('spras', 'Language'), f('vtext', 'PaymentTermsName')], text=True)
view('I_IncotermsClassification', 'Incoterms Classification', 'tinc', [k('inco1', 'IncotermsClassification'), f('ortob', 'LocationIsMandatory')],
     TXT('I_IncotermsClassificationText', '$projection.IncotermsClassification = _Text.IncotermsClassification'))
view('I_IncotermsClassificationText', 'Incoterms Classification - Text', 'tinct', [k('inco1', 'IncotermsClassification'), k('spras', 'Language'), f('bezei', 'IncotermsClassificationName')], text=True)
view('I_ShippingCondition', 'Shipping Condition', 'tvsb', [k('vsbed', 'ShippingCondition')], TXT('I_ShippingConditionText', '$projection.ShippingCondition = _Text.ShippingCondition'))
view('I_ShippingConditionText', 'Shipping Condition - Text', 'tvsbt', [k('vsbed', 'ShippingCondition'), k('spras', 'Language'), f('vtext', 'ShippingConditionName')], text=True)
view('I_ProductType', 'Product Type', 't134', [k('mtart', 'ProductType'), f('mtref', 'ProductTypeReference')], TXT('I_ProductTypeText', '$projection.ProductType = _Text.ProductType'))
view('I_ProductTypeText', 'Product Type - Text', 't134t', [k('mtart', 'ProductType'), k('spras', 'Language'), f('mtbez', 'ProductTypeName')], text=True)
view('I_ProductGroup_2', 'Product Group', 't023', [k('matkl', 'ProductGroup'), f('begru', 'AuthorizationGroup')], TXT('I_ProductGroupText_2', '$projection.ProductGroup = _Text.ProductGroup'))
view('I_ProductGroupText_2', 'Product Group - Text', 't023t', [k('matkl', 'ProductGroup'), k('spras', 'Language'), f('wgbez', 'ProductGroupName'), f('wgbez60', 'ProductGroupText')], text=True)
view('I_MRPType', 'MRP Type', 't438a', [k('dismm', 'MRPType'), f('disvf', 'MRPProcedure')], TXT('I_MRPTypeText', '$projection.MRPType = _Text.MRPType'))
view('I_MRPTypeText', 'MRP Type - Text', 't438t', [k('dismm', 'MRPType'), k('spras', 'Language'), f('dibez', 'MRPTypeName')], text=True)
view('I_CustomerAccountGroup', 'Customer Account Group', 't077d', [k('ktokd', 'CustomerAccountGroup'), f('numkr', 'NumberRangeInterval')],
     TXT('I_CustomerAccountGroupText', '$projection.CustomerAccountGroup = _Text.CustomerAccountGroup'))
view('I_CustomerAccountGroupText', 'Customer Account Group - Text', 't077x', [k('ktokd', 'CustomerAccountGroup'), k('spras', 'Language'), f('txt30', 'AccountGroupName')], text=True)
view('I_SupplierAccountGroup', 'Supplier Account Group', 't077k', [k('ktokk', 'SupplierAccountGroup'), f('numkr', 'NumberRangeInterval')],
     TXT('I_SupplierAccountGroupText', '$projection.SupplierAccountGroup = _Text.SupplierAccountGroup'))
view('I_SupplierAccountGroupText', 'Supplier Account Group - Text', 't077y', [k('ktokk', 'SupplierAccountGroup'), k('spras', 'Language'), f('txt30', 'AccountGroupName')], text=True)
view('I_BusinessPartnerGrouping', 'Business Partner Grouping', 'tb001', [k('bu_group', 'BusinessPartnerGrouping'), f('nrrng', 'NumberRangeInterval')],
     TXT('I_BusinessPartnerGroupingText', '$projection.BusinessPartnerGrouping = _Text.BusinessPartnerGrouping'))
view('I_BusinessPartnerGroupingText', 'Business Partner Grouping - Text', 'tb002', [k('bu_group', 'BusinessPartnerGrouping'), k('spras', 'Language'), f('txt40', 'BusinessPartnerGroupingText')], text=True)
view('I_GLAccountGroup', 'G/L Account Group', 't077s', [k('ktopl', 'ChartOfAccounts'), k('ktoks', 'GLAccountGroup')],
     TXT('I_GLAccountGroupText', '$projection.ChartOfAccounts = _Text.ChartOfAccounts and $projection.GLAccountGroup = _Text.GLAccountGroup'))
view('I_GLAccountGroupText', 'G/L Account Group - Text', 't077z', [k('ktopl', 'ChartOfAccounts'), k('ktoks', 'GLAccountGroup'), k('spras', 'Language'), f('txt30', 'AccountGroupName')], text=True)

# master data
view('I_Address_2', 'Address', 'adrc', [k('addrnumber', 'AddressID'), f('name1', 'OrganizationName1'), f('name2', 'OrganizationName2'), f('street', 'StreetName'),
     f('house_num1', 'HouseNumber'), f('post_code1', 'PostalCode'), f('city1', 'CityName'), f('country', 'Country'), f('region', 'Region'), f('langu', 'CorrespondenceLanguage'),
     f('tel_number', 'PhoneNumber'), f('smtp_addr', 'EmailAddress')], where="nation = ' '")
view('I_BusinessPartner', 'Business Partner', 'but000', [k('partner', 'BusinessPartner'), f('type', 'BusinessPartnerCategory'), f('bu_group', 'BusinessPartnerGrouping'),
     f("case type when '1' then concat_with_space(name_first, name_last, 1) else name_org1 end", 'BusinessPartnerFullName'),
     f("case type when '1' then concat_with_space(name_first, name_last, 1) else name_org1 end", 'BusinessPartnerName'),
     f('name_first', 'FirstName'), f('name_last', 'LastName'), f('name_org1', 'OrganizationBPName1'), f('name_org2', 'OrganizationBPName2'), f('bu_sort1', 'SearchTerm1'),
     f('xblck', 'BusinessPartnerIsBlocked'), f('xdele', 'IsMarkedForArchiving'), f('crdat', 'CreationDate'), f('crusr', 'CreatedByUser'), f('chdat', 'LastChangeDate')],
     ('association [0..*] to I_BusinessPartnerRole as _BusinessPartnerRole on $projection.BusinessPartner = _BusinessPartnerRole.BusinessPartner',
      'association [0..1] to I_Customer as _Customer on $projection.BusinessPartner = _Customer.Customer',
      'association [0..1] to I_Supplier as _Supplier on $projection.BusinessPartner = _Supplier.Supplier'))
view('I_BusinessPartnerRole', 'Business Partner Role', 'but100', [k('partner', 'BusinessPartner'), k('rltyp', 'BusinessPartnerRole'), f('valid_from', 'ValidityStartDate'),
     f('valid_to', 'ValidityEndDate')])
view('I_Customer', 'Customer', 'kna1', [k('kunnr', 'Customer'), f('name1', 'CustomerName'), f("concat_with_space(name1, name2, 1)", 'CustomerFullName'), f('ktokd', 'CustomerAccountGroup'),
     f('land1', 'Country'), f('regio', 'Region'), f('ort01', 'CityName'), f('pstlz', 'PostalCode'), f('stras', 'StreetName'), f('telf1', 'TelephoneNumber1'), f('stcd1', 'TaxNumber1'),
     f('stceg', 'VATRegistration'), f('spras', 'Language'), f('adrnr', 'AddressID'), f('lifnr', 'Supplier'), f('loevm', 'DeletionIndicator'), f('aufsd', 'OrderIsBlockedForCustomer'),
     f('erdat', 'CreationDate'), f('ernam', 'CreatedByUser')],
     ('association [0..*] to I_CustomerCompany as _CustomerCompany on $projection.Customer = _CustomerCompany.Customer',
      'association [0..*] to I_CustomerSalesArea as _CustomerSalesArea on $projection.Customer = _CustomerSalesArea.Customer',
      'association [0..1] to I_Address_2 as _AddressDefaultRepresentation on $projection.AddressID = _AddressDefaultRepresentation.AddressID'))
view('I_CustomerCompany', 'Customer Company', 'knb1', [k('kunnr', 'Customer'), k('bukrs', 'CompanyCode'), f('akont', 'ReconciliationAccount'), f('zterm', 'PaymentTerms'),
     f('busab', 'AccountingClerk'), f('loevm', 'DeletionIndicator')])
view('I_CustomerSalesArea', 'Customer Sales Area', 'knvv', [k('kunnr', 'Customer'), k('vkorg', 'SalesOrganization'), k('vtweg', 'DistributionChannel'), k('spart', 'Division'),
     f('waers', 'Currency'), f('zterm', 'CustomerPaymentTerms'), f('inco1', 'IncotermsClassification'), f('inco2', 'IncotermsTransferLocation'), f('vsbed', 'ShippingCondition'),
     f('konda', 'CustomerPriceGroup'), f('kalks', 'CustomerPricingProcedure'), f('aufsd', 'SalesIsBlockedForCustomer'), f('loevm', 'DeletionIndicator')])
view('I_Supplier', 'Supplier', 'lfa1', [k('lifnr', 'Supplier'), f('name1', 'SupplierName'), f("concat_with_space(name1, name2, 1)", 'SupplierFullName'), f('ktokk', 'SupplierAccountGroup'),
     f('land1', 'Country'), f('regio', 'Region'), f('ort01', 'CityName'), f('pstlz', 'PostalCode'), f('stras', 'StreetName'), f('telf1', 'PhoneNumber1'), f('stcd1', 'TaxNumber1'),
     f('stceg', 'VATRegistration'), f('spras', 'SupplierLanguage'), f('adrnr', 'AddressID'), f('kunnr', 'Customer'), f('loevm', 'DeletionIndicator'),
     f('sperr', 'PostingIsBlocked'), f('erdat', 'CreationDate'), f('ernam', 'CreatedByUser')],
     ('association [0..*] to I_SupplierCompany as _SupplierCompany on $projection.Supplier = _SupplierCompany.Supplier',
      'association [0..*] to I_SupplierPurchasingOrg as _SupplierPurchasingOrg on $projection.Supplier = _SupplierPurchasingOrg.Supplier',
      'association [0..1] to I_Address_2 as _AddressDefaultRepresentation on $projection.AddressID = _AddressDefaultRepresentation.AddressID'))
view('I_SupplierCompany', 'Supplier Company', 'lfb1', [k('lifnr', 'Supplier'), k('bukrs', 'CompanyCode'), f('akont', 'ReconciliationAccount'), f('zterm', 'PaymentTerms'),
     f('loevm', 'DeletionIndicator')])
view('I_SupplierPurchasingOrg', 'Supplier Purchasing Organization', 'lfm1', [k('lifnr', 'Supplier'), k('ekorg', 'PurchasingOrganization'), f('waers', 'PurchaseOrderCurrency'),
     f('zterm', 'PaymentTerms'), f('inco1', 'IncotermsClassification'), f('inco2', 'IncotermsTransferLocation'), f('webre', 'InvoiceIsGoodsReceiptBased'),
     f('verkf', 'SupplierRespSalesPersonName'), f('telf1', 'SupplierPhoneNumber'), f('loevm', 'DeletionIndicator')])
view('I_Product', 'Product', 'mara', [k('matnr', 'Product'), f('mtart', 'ProductType'), f('matkl', 'ProductGroup'), f('meins', 'BaseUnit'), f('brgew', 'GrossWeight'),
     f('ntgew', 'NetWeight'), f('gewei', 'WeightUnit'), f('volum', 'MaterialVolume'), f('voleh', 'VolumeUnit'), f('spart', 'Division'), f('bismt', 'ProductOldID'),
     f('ean11', 'ProductStandardID'), f('mstae', 'CrossPlantStatus'), f('lvorm', 'IsMarkedForDeletion'), f('ersda', 'CreationDate'), f('ernam', 'CreatedByUser'),
     f('laeda', 'LastChangeDate')],
     ('association [0..*] to I_ProductDescription as _Text on $projection.Product = _Text.Product',
      'association [0..*] to I_ProductPlantBasic as _ProductPlant on $projection.Product = _ProductPlant.Product',
      'association [0..1] to I_ProductType as _ProductType on $projection.ProductType = _ProductType.ProductType',
      'association [0..1] to I_ProductGroup_2 as _ProductGroup on $projection.ProductGroup = _ProductGroup.ProductGroup'))
view('I_ProductDescription', 'Product Description', 'makt', [k('matnr', 'Product'), k('spras', 'Language'), f('maktx', 'ProductDescription')], text=True)
view('I_ProductText', 'Product - Text', 'makt', [k('matnr', 'Product'), k('spras', 'Language'), f('maktx', 'ProductName')], text=True)
view('I_ProductUnitsOfMeasure', 'Product Units of Measure', 'marm', [k('matnr', 'Product'), k('meinh', 'AlternativeUnit'), f('umrez', 'QuantityNumerator'),
     f('umren', 'QuantityDenominator'), f('ean11', 'ProductStandardID')])
view('I_ProductPlantBasic', 'Product Plant', 'marc', [k('matnr', 'Product'), k('werks', 'Plant'), f('ekgrp', 'PurchasingGroup'), f('dismm', 'MRPType'), f('dispo', 'MRPResponsible'),
     f('beskz', 'ProcurementType'), f('plifz', 'PlannedDeliveryDurationInDays'), f('minbe', 'ReorderThresholdQuantity'), f('eisbe', 'SafetyStockQuantity'),
     f('prctr', 'ProfitCenter'), f('mmsta', 'ProfileCode'), f('lvorm', 'IsMarkedForDeletion')],
     ('association [1..1] to I_Plant as _Plant on $projection.Plant = _Plant.Plant',))
view('I_ProductStorageLocationBasic', 'Product Storage Location', 'mard', [k('matnr', 'Product'), k('werks', 'Plant'), k('lgort', 'StorageLocation'),
     f('lgpbe', 'WarehouseStorageBin'), f('lvorm', 'IsMarkedForDeletion')])
view('I_ProductValuationBasic', 'Product Valuation', 'mbew', [k('matnr', 'Product'), k('bwkey', 'ValuationArea'), k('bwtar', 'ValuationType'), f('vprsv', 'InventoryValuationProcedure'),
     f('verpr', 'MovingAveragePrice'), f('stprs', 'StandardPrice'), f('peinh', 'PriceUnitQty'), f('bklas', 'ValuationClass'), f('waers', 'Currency')])
view('I_ProductSalesDelivery', 'Product Sales Delivery', 'mvke', [k('matnr', 'Product'), k('vkorg', 'ProductSalesOrg'), k('vtweg', 'ProductDistributionChnl'),
     f('dwerk', 'SupplyingPlant'), f('vrkme', 'SalesMeasureUnit'), f('aumng', 'MinimumOrderQuantity'), f('mtpos', 'ItemCategoryGroup'), f('lvorm', 'IsMarkedForDeletion')])
view('I_GLAccountInChartOfAccounts', 'G/L Account in Chart of Accounts', 'ska1', [k('ktopl', 'ChartOfAccounts'), k('saknr', 'GLAccount'), f('xbilk', 'IsBalanceSheetAccount'),
     f('gvtyp', 'ProfitLossAccountType'), f('ktoks', 'GLAccountGroup'), f('glaccount_type', 'GLAccountType')],
     ('association [0..*] to I_GLAccountText as _Text on $projection.ChartOfAccounts = _Text.ChartOfAccounts and $projection.GLAccount = _Text.GLAccount',))
view('I_GLAccountText', 'G/L Account - Text', 'skat', [k('ktopl', 'ChartOfAccounts'), k('saknr', 'GLAccount'), k('spras', 'Language'), f('txt20', 'GLAccountName'),
     f('txt50', 'GLAccountLongName')], text=True)
view('I_GLAccountInCompanyCode', 'G/L Account in Company Code', 'skb1', [k('bukrs', 'CompanyCode'), k('saknr', 'GLAccount'), f('waers', 'AccountCurrency'),
     f('mitkz', 'ReconciliationAccountType'), f('xspeb', 'AccountIsBlockedForPosting'), f('xopvw', 'IsOpenItemManaged')])
view('I_CostCenter', 'Cost Center', 'csks', [k('kokrs', 'ControllingArea'), k('kostl', 'CostCenter'), k('datbi', 'ValidityEndDate'), f('datab', 'ValidityStartDate'),
     f('bukrs', 'CompanyCode'), f('prctr', 'ProfitCenter'), f('kosar', 'CostCenterCategory'), f('verak', 'CostCtrResponsiblePersonName'), f('waers', 'CostCenterCurrency')],
     ('association [0..*] to I_CostCenterText as _Text on $projection.ControllingArea = _Text.ControllingArea and $projection.CostCenter = _Text.CostCenter and $projection.ValidityEndDate = _Text.ValidityEndDate',))
view('I_CostCenterText', 'Cost Center - Text', 'cskt', [k('kokrs', 'ControllingArea'), k('kostl', 'CostCenter'), k('datbi', 'ValidityEndDate'), k('spras', 'Language'),
     f('ktext', 'CostCenterName'), f('ltext', 'CostCenterDescription')], text=True)
view('I_ProfitCenter', 'Profit Center', 'cepc', [k('kokrs', 'ControllingArea'), k('prctr', 'ProfitCenter'), k('datbi', 'ValidityEndDate'), f('datab', 'ValidityStartDate'),
     f('bukrs', 'CompanyCode'), f('verak', 'ProfitCtrResponsiblePersonName'), f('segment', 'Segment')],
     ('association [0..*] to I_ProfitCenterText as _Text on $projection.ControllingArea = _Text.ControllingArea and $projection.ProfitCenter = _Text.ProfitCenter and $projection.ValidityEndDate = _Text.ValidityEndDate',))
view('I_ProfitCenterText', 'Profit Center - Text', 'cepct', [k('kokrs', 'ControllingArea'), k('prctr', 'ProfitCenter'), k('datbi', 'ValidityEndDate'), k('spras', 'Language'),
     f('ktext', 'ProfitCenterName'), f('ltext', 'ProfitCenterLongName')], text=True)
view('I_Bank_2', 'Bank', 'bnka', [k('banks', 'BankCountry'), k('bankl', 'BankInternalID'), f('banka', 'BankName'), f('ort01', 'CityName'), f('stras', 'StreetName'),
     f('swift', 'SWIFTCode'), f('loevm', 'IsMarkedForDeletion')])

# ------------------------------------------------------------------ catalog: the objects by business area, for the studio
AREAS = [
    ('organisation', 'Organisation', 'Company codes, plants, sales and purchasing organisations',
     ['I_CompanyCode', 'I_Plant', 'I_StorageLocation', 'I_ValuationArea', 'I_SalesOrganization', 'I_DistributionChannel', 'I_Division', 'I_SalesArea',
      'I_PurchasingOrganization', 'I_PurchasingGroup', 'I_ControllingArea']),
    ('partners', 'Business partners', 'Customers, suppliers, addresses and banks',
     ['I_BusinessPartner', 'I_Customer', 'I_CustomerCompany', 'I_CustomerSalesArea', 'I_Supplier', 'I_SupplierCompany', 'I_SupplierPurchasingOrg',
      'I_BusinessPartnerRole', 'I_Address_2', 'I_Bank_2']),
    ('products', 'Products', 'Products with plant, stock, valuation and sales data',
     ['I_Product', 'I_ProductPlantBasic', 'I_ProductStorageLocationBasic', 'I_ProductValuationBasic', 'I_ProductSalesDelivery', 'I_ProductUnitsOfMeasure',
      'I_ProductType', 'I_ProductGroup_2', 'I_MRPType']),
    ('finance', 'Finance', 'Chart of accounts, G/L accounts, cost and profit centers',
     ['I_ChartOfAccounts', 'I_GLAccountInChartOfAccounts', 'I_GLAccountInCompanyCode', 'I_GLAccountGroup', 'I_CostCenter', 'I_ProfitCenter',
      'I_FiscalYearVariant', 'I_PaymentTerms']),
    ('config', 'Configuration', 'Countries, currencies, exchange rates, units and other settings',
     ['I_Country', 'I_Region', 'I_Currency', 'I_ExchangeRateRawData', 'I_ExchangeRateType', 'I_UnitOfMeasure', 'I_Language', 'I_TimeZone', 'I_IncotermsClassification',
      'I_ShippingCondition', 'I_CustomerAccountGroup', 'I_SupplierAccountGroup', 'I_BusinessPartnerGrouping']),
]

def catalog():
    by = {v[0]: v for v in VIEWS}
    texts = {}
    for name, _, _, _, assocs, _, _ in VIEWS:
        for a in assocs:
            if ' as _Text ' in a: texts[name] = [a.split(' to ')[1].split(' ')[0]]
    texts['I_Product'] = ['I_ProductDescription', 'I_ProductText']
    listed = {v for *_, vs in AREAS for v in vs}
    missing = [v[0] for v in VIEWS if not v[6] and v[0] not in listed]
    assert not missing, f'views without an area: {missing}'
    return {'areas': [{'id': i, 'title': t, 'description': d, 'objects': [
        {'view': v, 'label': by[v][1], 'table': by[v][2], 'texts': texts.get(v, [])} for v in vs]} for i, t, d, vs in AREAS]}

# ------------------------------------------------------------------ write
def table_src(name, label, fields):
    out = [f"@EndUserText.label : '{label}'", f'define table {name} {{']
    width = max(len(n) for n, *_ in fields) + 1
    for n, t, key, ref in fields:
        ann = ''
        if ref and t.startswith('abap.curr'): out.append(f"  @Semantics.amount.currencyCode : '{ref}'")
        if ref and t.startswith('abap.quan'): out.append(f"  @Semantics.quantity.unitOfMeasure : '{ref}'")
        out.append(f"  {'key ' if key else ''}{n.ljust(width - (4 if key else 0) + 4)}: {t}{' not null' if key else ''};")
    out.append('}')
    return '\n'.join(out) + '\n'

def view_src(name, label, source, cols, assocs, where, text):
    out = ['@AccessControl.authorizationCheck: #NOT_REQUIRED', f"@EndUserText.label: '{label}'", '@VDM.viewType: #BASIC']
    if text: out.append('@ObjectModel.dataCategory: #TEXT')
    out += ['@ObjectModel.usageType.dataClass: #MASTER', f'define view entity {name}', f'  as select from {source}']
    out += [f'  {a}' for a in assocs]
    out.append('{')
    lines = [f"  {'key ' if key else '    '}{expr} as {alias}" for expr, alias, key in cols]
    lines += [f'    {a.split(" as ")[1].split(" ")[0]}' for a in assocs]
    out.append(',\n'.join(lines))
    # where: a condition, or 'group by …' for an aggregating view (both: '<condition>\ngroup by …')
    if where and where.startswith('group by'): out.append('}\n' + where)
    elif where and '\ngroup by' in where: out.append('}\nwhere ' + where)
    else: out.append('}' + (f'\nwhere {where}' if where else ''))
    return '\n'.join(out) + '\n'

if __name__ == '__main__':
    # sales, purchasing, inventory, accounting, production, maintenance, … (transactional.py, from dictionaries.json)
    import transactional
    transactional.extend(TABLES, VIEWS, D, table, view, k, f, AREAS)
    for d in (SRC, DATA): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for name, (label, fields) in TABLES.items():
        open(os.path.join(SRC, f"{name.replace('/', '#')}.tabl.cds"), 'w').write(table_src(name, label, fields))
    for v in VIEWS:
        open(os.path.join(SRC, f'{v[0].lower()}.ddls.asddls'), 'w').write(view_src(*v))
    for t, recs in D.items():
        cols = [(n, ty) for n, ty, *_ in TABLES[t][1] if n != 'mandt']
        empty = lambda ty: 0 if ty.startswith(('abap.curr', 'abap.quan', 'abap.dec', 'abap.int')) else ''
        with open(os.path.join(DATA, f"{t.replace('/', '#')}.json"), 'w') as fh:   # abapGit file names: /scwm/lagp = #scwm#lagp
            fh.write('[\n' + ',\n'.join('  ' + json.dumps({c: r.get(c, empty(ty)) for c, ty in cols}, ensure_ascii=False) for r in recs) + '\n]\n')
    with open(os.path.join(OUT, 'catalog.json'), 'w') as fh: json.dump(catalog(), fh, indent=1)
    print(f'{len(TABLES)} tables, {len(VIEWS)} views, {sum(len(r) for r in D.values())} rows')
