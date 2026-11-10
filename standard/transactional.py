"""The transactional and further configuration tables of the SAP standard layer, from S/4HANA data dictionary documents
(standard/dictionaries.json, made by extract_dictionaries.py): sales, delivery and billing, purchasing, inventory,
the universal journal and accounting documents, controlling, asset accounting, production, maintenance, quality,
projects, classification, business partners, output, workflow and other cross-application tables, with the released
CDS views on top and consistent demo data: documents that follow each other (order -> delivery -> goods issue ->
billing -> journal entry -> payment; requisition -> purchase order -> goods receipt -> supplier invoice), built from the
master data of generate.py.

Called by generate.py: extend(TABLES, VIEWS, D, table, view, k, f, AREAS). The definitions are RAP Studio's own: the
documents' tables and fields, SAP's primary keys, simple types.
"""
import json, os, random, re, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(4711)

# ------------------------------------------------------------------ corrections of what the documents say
SKIP = {'T000', 'IWFND', 'MKPF', 'MSEG', 'VBAKUK', 'VBAPUK'}   # T000: open-abap; IWFND: no table; compatibility views: CDS views below
KEYS = {
    'ACDOCA': ['RLDNR', 'RBUKRS', 'GJAHR', 'BELNR', 'DOCLN'], 'ACDOCP': ['RLDNR', 'RBUKRS', 'GJAHR', 'BELNR', 'DOCLN'],
    'ACDOCU': ['RLDNR', 'RVERS', 'RYEAR', 'DOCNR', 'DOCLN'], 'EQUK': ['QUNUM'], 'FAGL_011PC': ['VERSN', 'ERGSL'], 'FAGL_011ZC': ['VERSN', 'ERGSL', 'VONKT'],
    'FAGL_SEGM': ['SEGMENT'], 'FCLM_BAM_ACLINK2': ['ACC_ID', 'BUKRS', 'HBKID', 'HKTID'], 'FQM_FLOW': ['FLOW_ID'],
    'MARDH': ['MATNR', 'WERKS', 'LGORT', 'LFGJA', 'LFMON'], 'MBEWH': ['MATNR', 'BWKEY', 'BWTAR', 'LFGJA', 'LFMON'],
    'MATDOC': ['MBLNR', 'MJAHR', 'ZEILE'], 'MATDOC_EXTRACT': ['MATNR', 'WERKS', 'LGORT', 'CHARG', 'SOBKZ', 'LBBSA'],
    'PA0000': ['PERNR', 'SUBTY', 'OBJPS', 'SPRPS', 'ENDDA', 'BEGDA', 'SEQNR'], 'PA0001': ['PERNR', 'SUBTY', 'OBJPS', 'SPRPS', 'ENDDA', 'BEGDA', 'SEQNR'],
    'PA0002': ['PERNR', 'SUBTY', 'OBJPS', 'SPRPS', 'ENDDA', 'BEGDA', 'SEQNR'], 'PA0008': ['PERNR', 'SUBTY', 'OBJPS', 'SPRPS', 'ENDDA', 'BEGDA', 'SEQNR'],
    'PKHD': ['PKNUM'], 'PKPS': ['PKNUM', 'PKPOS'], 'PROP': ['PNUM1', 'HSNUM', 'VERSP', 'PERIO'], 'SETHEADER': ['SETCLASS', 'SUBCLASS', 'SETNAME'],
    'SETLEAF': ['SETCLASS', 'SUBCLASS', 'SETNAME', 'LINEID'], 'SETNODE': ['SETCLASS', 'SUBCLASS', 'SETNAME', 'LINEID'], 'SOFFCONT1': ['RELID', 'PHIO_ID'],
    'VBFA': ['RUUID'], 'VEKP': ['VENUM'], 'VEPO': ['VENUM', 'VEPOS'], 'VTTK': ['TKNUM'], 'VTTP': ['TKNUM', 'TPNUM'], 'FPLA': ['FPLNR'], 'FPLT': ['FPLNR', 'FPLTR'],
    'T093': ['AFAPL', 'AFABER'], 'T093C': ['BUKRS'], 'T685A': ['KAPPL', 'KSCHL'], 'KONH': ['KNUMH'], 'KONP': ['KNUMH', 'KOPOS'],
    'A005': ['KAPPL', 'KSCHL', 'VKORG', 'VTWEG', 'KUNNR', 'MATNR', 'DATBI'], 'A305': ['KAPPL', 'KSCHL', 'VKORG', 'VTWEG', 'KUNNR', 'MATNR', 'DATBI'],
    'A017': ['KAPPL', 'KSCHL', 'LIFNR', 'MATNR', 'EKORG', 'WERKS', 'ESOKZ', 'DATBI'], 'A018': ['KAPPL', 'KSCHL', 'LIFNR', 'MATNR', 'EKORG', 'ESOKZ', 'DATBI'],
    'TKA02': ['BUKRS', 'GSBER'], 'T156T': ['SPRAS', 'BWART'], 'MAPR': ['MATNR', 'WERKS'], 'BUT100': ['PARTNER', 'RLTYP', 'DFVAL'], 'KNVK': ['PARNR'], 'MKAL': ['MATNR', 'WERKS', 'VERID'],
    'CVI_CUST_LINK': ['PARTNER_GUID'], 'CVI_VEND_LINK': ['PARTNER_GUID'], 'USR21': ['BNAME'], 'TBTCO': ['JOBNAME', 'JOBCOUNT'], 'T009B': ['PERIV', 'BDATJ', 'BUMON', 'BUTAG'],
}
DESC = {'EQUK': 'Quota arrangement header', 'KONH': 'Condition record header', 'KONP': 'Condition record items', 'KONM': 'Condition quantity scales',
        'KONW': 'Condition value scales', 'MKPF': 'Material document header', 'FPLA': 'Billing plan', 'FPLT': 'Billing plan dates', 'VEKP': 'Handling unit header',
        'VEPO': 'Handling unit items', 'VTTK': 'Shipment header', 'VTTP': 'Shipment items', 'PKHD': 'Kanban control cycle', 'PKPS': 'Kanban containers',
        'SETHEADER': 'Set header', 'SETLEAF': 'Set values', 'SETNODE': 'Set hierarchy nodes', 'SOOD': 'Office documents', 'SOFFCONT1': 'Office document content',
        'T685A': 'Condition types (pricing)', 'T093C': 'Asset accounting settings per company code', 'MAPR': 'Forecast parameters', 'PROP': 'Forecast values',
        'A005': 'Customer/material condition records (access)', 'A305': 'Customer/material with release status (access)',
        'A017': 'Supplier/material/plant info record conditions (access)', 'A018': 'Supplier/material info record conditions (access)',
        'TOA01': 'ArchiveLink links (table 1)', 'TOA02': 'ArchiveLink links (table 2)', 'TOA03': 'ArchiveLink links (table 3)', 'TOAHR': 'ArchiveLink links (HR)',
        'FAGL_011PC': 'Financial statement version: nodes', 'FAGL_011ZC': 'Financial statement version: account assignments', 'MBEWH': 'Valuation history',
        'MARDH': 'Storage location stock history', 'T009B': 'Fiscal year variant periods', 'T156T': 'Movement type texts'}
EXTRA = {   # fields the documents leave out but the data and the views need
    'A005': ['VKORG', 'VTWEG', 'KUNNR', 'MATNR'], 'A305': ['VKORG', 'VTWEG', 'KUNNR', 'MATNR'], 'A017': ['LIFNR', 'MATNR', 'EKORG', 'WERKS', 'ESOKZ'],
    'A018': ['LIFNR', 'MATNR', 'EKORG', 'ESOKZ'], 'EQUK': ['MATNR', 'WERKS', 'VDATU', 'BDATU'], 'KONH': ['KAPPL', 'KSCHL', 'DATAB', 'DATBI', 'ERDAT', 'ERNAM'],
    'MATDOC': ['KEY1', 'KEY2', 'KEY3', 'KEY4', 'KEY5', 'KEY6', 'CPUTM', 'BKTXT', 'VGART', 'RECORD_TYPE', 'STOCK_QTY', 'SMBLN', 'SMBLP', 'KZBEW', 'KZVBR', 'LBBSA', 'SGTXT'],
    'MATDOC_EXTRACT': ['STOCK_QTY', 'MEINS', 'VALUE_LC', 'WAERS'], 'VBFA': ['VBELV', 'POSNV', 'VBELN', 'POSNN', 'VBTYP_V', 'VBTYP_N', 'RFMNG', 'MEINS', 'RFWRT', 'WAERS', 'ERDAT', 'ERZET'],
    'FAGL_SEGM': ['NAME'], 'FQM_FLOW': ['BUKRS', 'FLOW_TYPE', 'AMOUNT', 'WAERS', 'VALUE_DATE', 'ORIGIN'], 'FCLM_BAM_ACLINK2': ['ACC_ID', 'BANKN', 'WAERS'],
    'SETLEAF': ['VALSIGN', 'VALOPTION', 'VALFROM', 'VALTO'], 'SETNODE': ['SUBSETNAME'], 'SETHEADER': ['DESCRIPT'], 'SOFFCONT1': ['RELID', 'PHIO_ID', 'CLUSTR', 'CLUSTD'],
    'PROP': ['PNUM1', 'HSNUM', 'VERSP', 'MATNR', 'WERKS', 'PERIO', 'PRWRT'], 'MAPR': ['PNUM1', 'PRMOD'], 'PKHD': ['MATNR', 'WERKS', 'PRVBE', 'BEHMG', 'BEHAZ'],
    'T009B': ['PERIV', 'BDATJ', 'BUMON', 'BUTAG', 'POPER', 'RELJR'], 'T156T': ['SPRAS', 'BWART', 'BTEXT'], 'T156': ['BWART', 'SHKZG', 'KZBEW', 'XSTBW'],
    'MKAL': ['TEXT1', 'ADATU', 'BDATU', 'PLNTY', 'PLNNR', 'ALNAL', 'STLAL', 'STLAN'], 'TVAP': ['FKREL', 'PRSFD'], 'TVKGR': ['BEZEI'],
    'T685A': ['KRECH', 'KOAID', 'KZNEP'], 'AUFK': ['AUTYP', 'AUART', 'KTEXT', 'BUKRS', 'WERKS', 'KOKRS', 'KOSTV', 'PRCTR', 'ERDAT', 'ERNAM', 'OBJNR'],
    'BUT021_FS': ['ADDRNUMBER', 'ADR_KIND', 'VALID_FROM'], 'USR02': ['CLASS'], 'CDPOS': ['VALUE_NEW', 'VALUE_OLD', 'UNIT_NEW', 'CUKY_NEW'],
}
NEW_TABLES = {'T009B', 'T156T'}

# ------------------------------------------------------------------ types
CUKY_F = {'WAERS', 'WAERK', 'RWCUR', 'RHCUR', 'RKCUR', 'RTCUR', 'HWAER', 'HWAE2', 'KONWA', 'CURRENCY', 'CUKY_NEW', 'RVCUR', 'ROCUR', 'WAERS_LC'}
UNIT_F = {'MEINS', 'VRKME', 'ERFME', 'BSTME', 'KMEIN', 'MEINH', 'RUNIT', 'LMEIN', 'GEWEI', 'VOLEH', 'BPRME', 'GMEIN', 'AMEIN', 'UNIT_NEW', 'MSEHI', 'MEINS_KO', 'RRUNIT'}
AMOUNT_F = {'PREIS', 'BET01', 'KWBTR', 'SUMHA', 'SUMSO', 'SSBTR', 'WT_QSSHB', 'WAVWR', 'STVAL', 'TKG001', 'KSLU', 'NETWR', 'NETPR', 'DMBTR', 'WRBTR', 'DMBE2', 'HSL', 'KSL', 'TSL', 'WSL', 'OSL', 'VSL', 'MWSBK', 'MWSBP', 'KWERT', 'KAWRT', 'RMWWR', 'WMWST1', 'WMWST',
            'SKFBT', 'BRTWR', 'RFWRT', 'SALK3', 'VERPR', 'STPRS', 'FAKWR', 'WTGBTR', 'WKGBTR', 'RBETR', 'RWBTR', 'FWSTE', 'HWSTE', 'FWBAS', 'HWBAS', 'WT_QSSHH',
            'WT_QBSHH', 'CREDIT_LIMIT', 'ANSWL', 'KANSW', 'KNAFA', 'NAFAP', 'NAFAG', 'AMOUNT', 'VALUE_LC', 'PRWRT', 'KZWI1', 'KZWI2', 'KZWI3', 'KZWI4', 'KZWI5', 'KZWI6',
            'FAKWR', 'NETWR_AK', 'BRGEW_V', 'WRSHB', 'DMSHB', 'ZBETR', 'RWBTR', 'WKGBTR', 'BETRG', 'BTRG', 'PVPRS', 'SALKV', 'HSLVT', 'KSLVT', 'NAFAV', 'ANBTR'}
QTY_F = {'LBKUM', 'VEMNG', 'LPMAX', 'LPMIN', 'PKIMG', 'QUANT', 'LOSMENGE', 'BTGEW', 'LHMG1', 'KSTBM', 'MENGE', 'KWMENG', 'KLMENG', 'LFIMG', 'LGMNG', 'FKIMG', 'FKLMG', 'ERFMG', 'BDMNG', 'ENMNG', 'WMENG', 'BMENG', 'LMENG', 'WEMNG', 'RFMNG', 'BUCHM', 'GAMNG',
         'PSMNG', 'IGMNG', 'LMNGA', 'XMNGA', 'RMNGA', 'LABST', 'INSME', 'SPEME', 'UMLME', 'CLABS', 'CINSM', 'STOCK_QTY', 'BSTMG', 'MSL', 'GSMNG', 'BSMNG', 'NORBM',
         'MINBM', 'AUMNG', 'MINBE', 'EISBE', 'BEHMG', 'WEMNG', 'GMNGA', 'ISM01', 'MGVRG', 'BMSCH', 'ZMENG', 'LGMNG', 'BSTMI', 'BSTMA', 'VSOLM', 'VSOLL', 'SOLLWERT'}
FLAG_F = {'LOEKZ', 'LOEVM', 'LVORM', 'ELIKZ', 'EREKZ', 'WEPOS', 'REPOS', 'WEBRE', 'KZEAR', 'XLOEK', 'FLIFN', 'NOTKZ', 'AUTLF', 'SHKZG', 'FRGKZ', 'KNTTP', 'DRCRK', 'KOART',
          'SOBKZ', 'XSTBW', 'KZBEW', 'KZVBR', 'XDFADR', 'XBLCK', 'UFLAG', 'CHNGIND', 'KINAK', 'KSTAT', 'XVORL', 'XAUTO', 'XNEGP', 'XUMSW', 'XSTOV', 'AUGRP', 'PLMIN',
          'STATU', 'FKSAA', 'FKSAK', 'GBSTA', 'GBSTK', 'LFSTA', 'LFSTK', 'FKSTK', 'ABSTA', 'ABSTK', 'BESTK', 'CMGST', 'KZFME', 'XZAEL', 'XDIFF', 'XNULL', 'DSTAT',
          'RBSTAT', 'VPRSV', 'BSTYP', 'ESOKZ', 'KVEWE', 'TYPE', 'XEGLD', 'VLFKZ', 'KZDKZ', 'XSPEB', 'XOPVW', 'XBILK', 'MITKZ', 'UMSKZ', 'BEWTP', 'VGABE', 'KRECH',
          'KOAID', 'KZNEP', 'ORTOB', 'NTYPE', 'FKREL', 'PRSFD', 'VALSIGN', 'ADDRNUMBER_X', 'SPRPS', 'KZART', 'MAFID', 'RSART', 'XAUFT', 'XFLIF', 'XSTBW', 'XINVR'}
CHAR = {'WBSTK': 1, 'KOSTK': 1, 'LIFSK': 2, 'VSBED': 2, 'POST1': 40, 'USRID': 30, 'USRID_LONG': 241, 'ORGTX': 40, 'NAME1': 30, 'STRAS': 60, 'ORT01': 40, 'VBELN': 10, 'VBELV': 10, 'VGBEL': 10, 'MATNR': 40, 'MATBF': 40, 'WERKS': 4, 'WERK': 4, 'DWERK': 4, 'LGORT': 4, 'CHARG': 10, 'BUKRS': 4, 'RBUKRS': 4, 'ZBUKR': 4,
        'KUNNR': 10, 'KUNAG': 10, 'KUNWE': 10, 'KUNRG': 10, 'KUNRE': 10, 'LIFNR': 10, 'LIEFERANT': 10, 'LIFN2': 10, 'LTSNR': 6, 'FLIEF': 10, 'PARTNER': 10,
        'PARTNER1': 10, 'PARTNER2': 10, 'EBELN': 10, 'KONNR': 10, 'BANFN': 10, 'BELNR': 10, 'MBLNR': 10, 'SMBLN': 10, 'LFBNR': 10, 'AUFNR': 12, 'KDAUF': 10,
        'KOSTL': 10, 'KOSTV': 10, 'RCNTR': 10, 'PRCTR': 10, 'PPRCTR': 10, 'SAKNR': 10, 'SAKTO': 10, 'RACCT': 10, 'HKONT': 10, 'AKONT': 10, 'KOKRS': 4,
        'EKORG': 4, 'EKGRP': 3, 'VKORG': 4, 'VTWEG': 2, 'SPART': 2, 'VKBUR': 4, 'VKGRP': 3, 'VSTEL': 4, 'ROUTE': 6, 'AUART': 4, 'BSART': 4, 'VBTYP': 4, 'VBTYP_N': 4,
        'VBTYP_V': 4, 'PSTYV': 4, 'ABGRU': 2, 'KSCHL': 4, 'KAPPL': 2, 'KALSM': 6, 'KNUMV': 10, 'KNUMH': 10, 'BWART': 3, 'ANBWA': 3, 'BSCHL': 2, 'BLART': 2,
        'MWSKZ': 2, 'ZTERM': 4, 'INCO1': 3, 'INCO2': 28, 'LAND1': 3, 'ALAND': 3, 'BANKS': 3, 'REGIO': 3, 'ANLN1': 12, 'ANLN2': 4, 'ANLKL': 8, 'POSID': 24,
        'PSPID': 24, 'EQUNR': 18, 'TPLNR': 40, 'QMNUM': 12, 'WARPL': 12, 'WAPOS': 16, 'OBJNR': 22, 'STAT': 5, 'ISTAT': 5, 'ESTAT': 5, 'STSMA': 8, 'SEGMENT': 10,
        'RLDNR': 2, 'AWTYP': 5, 'AWREF': 10, 'AWORG': 10, 'AWKEY': 20, 'XBLNR': 16, 'BKTXT': 25, 'SGTXT': 50, 'ZUONR': 18, 'AUGBL': 10, 'NAME1': 35, 'NAME': 40,
        'ARKTX': 40, 'MAKTX': 40, 'TXZ01': 40, 'KTEXT': 40, 'LTEXT': 40, 'BNAME': 12, 'ERNAM': 12, 'USNAM': 12, 'AENAM': 12, 'UNAME': 12, 'CRUSR': 12,
        'AGR_NAME': 30, 'TCODE': 20, 'OBJECTCLAS': 15, 'OBJECTID': 90, 'CHANGENR': 10, 'TABNAME': 30, 'TABKEY': 70, 'FNAME': 30, 'VALUE_NEW': 254, 'VALUE_OLD': 254,
        'RUUID': 32, 'PARVW': 2, 'ADRNR': 10, 'ADDRNUMBER': 10, 'PERSNUMBER': 10, 'TEL_NUMBER': 30, 'SMTP_ADDR': 241, 'KEY1': 10, 'KEY2': 4, 'KEY3': 4, 'KEY4': 10,
        'KEY5': 4, 'KEY6': 4, 'HBKID': 5, 'HKTID': 5, 'BANKL': 15, 'BANKN': 18, 'BKVID': 4, 'IBAN': 34, 'SWIFT': 11, 'RZAWE': 1, 'CHECT': 13, 'LAUFI': 6,
        'VBLNR': 10, 'EMPFG': 16, 'KTOPL': 4, 'KTOSL': 3, 'BWMOD': 4, 'KOMOK': 4, 'BKLAS': 4, 'BWKEY': 4, 'BWTAR': 10, 'VERSN': 4, 'ERGSL': 10, 'VONKT': 10,
        'GSBER': 4, 'MKOAR': 1, 'BKONT': 10, 'AFAPL': 4, 'AFABER': 2, 'MTART': 4, 'MATKL': 9, 'LGNUM': 3, 'LGTYP': 3, 'PLNTY': 1, 'PLNNR': 8, 'PLNAL': 2, 'PLNFL': 6,
        'STLAN': 1, 'STLNR': 8, 'STLAL': 2, 'STLTY': 1, 'VERID': 4, 'ARBPL': 8, 'OBJTY': 2, 'OBJID': 8, 'LSTAR': 6, 'DATUV': 8, 'POSTP': 1, 'IDNRK': 40,
        'VORNR': 4, 'STEUS': 4, 'KAPID': 8, 'PLNUM': 10, 'PAART': 4, 'RSNUM': 10, 'IBLNR': 10, 'DOKAR': 3, 'DOKNR': 25, 'DOKVR': 2, 'DOKTL': 3, 'DOKOB': 10,
        'OBJKY': 30, 'TDOBJECT': 10, 'TDNAME': 70, 'TDID': 4, 'RELID': 2, 'SAP_OBJECT': 10, 'OBJECT_ID': 50, 'ARCHIV_ID': 2, 'ARC_DOC_ID': 40, 'AR_OBJECT': 10,
        'LOGNUMBER': 20, 'OBJECT': 20, 'SUBOBJECT': 20, 'NRRANGENR': 2, 'JOBNAME': 32, 'JOBCOUNT': 8, 'DOCNUM': 16, 'MESTYP': 30, 'IDOCTP': 30, 'STATUS': 2,
        'WI_ID': 12, 'WI_TYPE': 1, 'WI_STAT': 12, 'WI_TEXT': 120, 'ELEMENT': 32, 'BRELGUID': 32, 'TYPEID_A': 32, 'INSTID_A': 70, 'TYPEID_B': 32, 'INSTID_B': 70,
        'RELTYPE': 4, 'OBJTP': 3, 'OBJYR': 2, 'OBJNO': 12, 'OBJDES': 50, 'FILE_EXT': 3, 'PLVAR': 2, 'OTYPE': 2, 'RSIGN': 1, 'RELAT': 3, 'SCLAS': 2, 'SOBID': 45,
        'PERNR': 8, 'SUBTY': 4, 'OBJPS': 2, 'MASSN': 2, 'MASSG': 2, 'STAT2': 1, 'PERSG': 1, 'PERSK': 2, 'ORGEH': 8, 'PLANS': 8, 'STELL': 8, 'NACHN': 40, 'VORNA': 40,
        'TRFAR': 2, 'TRFGB': 2, 'TRFGR': 8, 'TRFST': 2, 'IDENT': 2, 'LANGU': 1, 'ATINN': 10, 'ATNAM': 30, 'ATWRT': 30, 'ATFOR': 4, 'KLART': 3, 'CLASS': 18,
        'OBJEK': 50, 'CUOBJ': 18, 'MKMNR': 8, 'PRUEFLOS': 12, 'ART': 8, 'VCODE': 4, 'VBEWERTUNG': 1, 'QMTYP': 2, 'QMART': 2, 'QMTXT': 40, 'FECOD': 4,
        'FEGRP': 8, 'URCOD': 4, 'URGRP': 8, 'MNCOD': 4, 'MNGRP': 8, 'POINT': 12, 'PSORT': 20, 'MDOCM': 20, 'RECDC': 22, 'EQTYP': 1, 'EQART': 10, 'HERST': 30,
        'SERGE': 30, 'SERNR': 18, 'ILOAN': 12, 'STORT': 10, 'MSGRP': 8, 'BEBER': 3, 'SWERK': 4, 'IWERK': 4, 'INGRP': 3, 'GEWRK': 8, 'STRAT': 6, 'PSPNR': 8,
        'PSPHI': 8, 'PS_PSP_PNR': 8, 'PROJN': 8, 'POSNR_PS': 8, 'UP': 8, 'DOWN': 8, 'LEFT': 8, 'RIGHT': 8, 'KALNR': 12, 'CURTP': 2, 'DOCREF': 32, 'TJ': 4,
        'CREDIT_SGMNT': 10, 'RISK_CLASS': 3, 'CHECK_RULE': 10, 'CREDIT_GROUP': 4, 'TAXTYPE': 4, 'TAXNUM': 20, 'IDNUMBER': 60, 'WITHT': 2, 'WT_WITHCD': 2,
        'RELNR': 12, 'RELTYP': 6, 'RLTYP': 6, 'DFVAL': 6, 'ADR_KIND': 10, 'PARTNER_GUID': 32, 'CUSTOMER': 10, 'VENDOR': 10, 'KUKEY': 8, 'ESNUM': 5,
        'ACC_ID': 10, 'FLOW_ID': 20, 'FLOW_TYPE': 4, 'ORIGIN': 10, 'SETCLASS': 4, 'SUBCLASS': 12, 'SETNAME': 24, 'SUBSETNAME': 24, 'LINEID': 10, 'VALOPTION': 2,
        'VALFROM': 24, 'VALTO': 24, 'DESCRIPT': 40, 'PHIO_ID': 32, 'CLUSTD': 255, 'UFLAG': 3, 'USTYP': 1, 'TRDAT': 8, 'GLTGV': 8, 'GLTGB': 8, 'TYPE': 1,
        'ESOKZ': 1, 'INFNR': 10, 'IDNLF': 35, 'QUNUM': 10, 'RVERS': 3, 'DOCNR': 10, 'CATEGORY': 4, 'RYEAR': 4, 'BWKEY_WERKS': 4, 'FPLNR': 10, 'FPLTR': 6,
        'VENUM': 10, 'EXIDV': 20, 'VHILM': 40, 'TKNUM': 10, 'SHTYP': 4, 'TDLNR': 10, 'TPLST': 4, 'NACHA': 1, 'VSZTP': 1, 'PRVBE': 10, 'PKNUM': 10,
        'HSNUM': 2, 'VERSP': 2, 'PNUM1': 10, 'PRMOD': 1, 'PERIO': 6, 'ANLKL_TXT': 50, 'TXK20': 20, 'TXT50': 50, 'TXA50': 50, 'INVNR': 25, 'AKTIV': 8,
        'DEAKT': 8, 'GDLGRP': 8, 'ORD41': 4, 'CABN_ATNAM': 30, 'CLINT': 10, 'SEGNUM': 6, 'SEGNAM': 30, 'SDATA': 1000, 'LOGDAT': 8, 'LOGTIM': 6,
        'STAMID': 20, 'STAMNO': 3, 'STATXT': 70, 'TDLINE': 132, 'KZBEW': 1, 'LBBSA': 2, 'RECORD_TYPE': 4, 'CATEGORY_PLAN': 4, 'NAME_ORG1': 40, 'NAME_FIRST': 40,
        'NAME_LAST': 40, 'TITLE': 4, 'BU_GROUP': 4, 'BPKIND': 4, 'BU_SORT1': 20, 'TITLE_MEDI': 30, 'NAMEV': 35, 'NAME2': 35, 'NAME3': 35, 'NAME4': 35,
        'ORT01': 35, 'PSTLZ': 10, 'STRAS': 35, 'TELF1': 16, 'STCD1': 16, 'STCEG': 20, 'ABTNR': 4, 'PAFKT': 2, 'FUNCT': 2, 'TATYP': 4, 'TAXKD': 1, 'TAXM1': 1,
        'GLACCOUNT_TYPE': 1, 'BTEXT': 20, 'TEXT1': 40, 'AFAPL_T': 50, 'GRUPP': 8, 'ART_VBA': 1}
NUMC = {'POSNR': 6, 'POSNV': 6, 'POSNN': 6, 'KPOSN': 6, 'UEPOS': 6, 'VGPOS': 6, 'VPOSN': 6, 'VBELP_IM': 6, 'KDPOS': 6, 'VBELP': 6, 'EBELP': 5, 'KTPNR': 5,
        'BNFPO': 5, 'ETENR': 4, 'ETENS': 4, 'ZEILE': 4, 'SMBLP': 4, 'ZEILI': 3, 'MJAHR': 4, 'GJAHR': 4, 'LFGJA': 4, 'SJAHR': 4, 'BDATJ': 4, 'RELJR': 2,
        'BUZEI': 3, 'POPER': 3, 'MONAT': 2, 'LFMON': 2, 'BUMON': 2, 'BUTAG': 2, 'LFPOS': 4, 'ZEKKN': 2, 'ZEBKN': 2, 'RSPOS': 4, 'STUNR': 3, 'ZAEHK': 3,
        'AWITEM': 6, 'STKOZ': 8, 'STPOZ': 8, 'STLKN': 8, 'STASZ': 8, 'ZAEHL': 8, 'PLNKN': 8, 'APLZL': 8, 'AUFPL': 10, 'RMZHL': 8, 'RUECK': 10, 'MERKNR': 4,
        'VORGLFNR': 8, 'ZAEHLER': 8, 'FENUM': 4, 'URNUM': 4, 'MANUM': 4, 'SEQNR': 3, 'CONSNUMBER': 3, 'PARZA': 3, 'COUNTER': 6, 'COUNTR': 6, 'KOPOS': 2,
        'KLFN1': 4, 'ADZHL': 4, 'ATZHL': 4, 'ABNUM': 4, 'EQLFN': 3, 'ZEORD': 5, 'OBZAE': 4, 'TAB_INDEX': 6, 'UNTPER': 3, 'PKPOS': 3, 'VEPOS': 6, 'TPNUM': 4,
        'PARNR': 10, 'COBL_NR': 4, 'SUBTA': 6, 'AFABE': 2, 'DOCLN': 6, 'PRIOX': 2, 'DETAILERG': 6, 'VERSION': 6, 'SPRAS_N': 1, 'AFKO_GLTRP': 8, 'BAUJJ': 4,
        'PERSNUMBER_N': 10, 'LANUM': 4, 'LASET': 6, 'ANZBP': 3, 'PLNFL_N': 6, 'ZKRIZ': 10, 'ATZHL_N': 4, 'DETAIL': 6}
DATES = {'SDLSTRTDT', 'STRTDATE', 'ZALDT', 'AR_DATE', 'WI_CD', 'ALDATE', 'GUELTIGAB', 'ERZDATUM', 'PRUEFDATUV', 'VDATUM', 'PASTRTERM', 'PAENDTERM', 'FREI_DAT', 'VFDAT', 'HSDAT', 'PSTER', 'PETER', 'SAEDT', 'FSAVD', 'FSEDD', 'PLFAZ', 'PLSEZ', 'FTRMI', 'GETRI', 'LTRMI', 'ADATUM', 'VONDT', 'BISDT', 'ABRECHDAT', 'FKDAT_RL', 'ENDAT', 'RSDAT', 'H_BUDAT', 'H_BLDAT', 'AEDTM', 'FROM_DAT', 'BUDAT', 'BLDAT', 'CPUDT', 'ERSDA', 'AEDAT', 'BEDAT', 'BADAT', 'LFDAT', 'PRSDT', 'ZFBDT', 'AUGDT', 'VALUT', 'INBDT', 'GSTRP', 'GLTRP', 'GSTRS', 'GLTRS',
         'PSTTR', 'PEDTR', 'ISDD', 'IEDD', 'GIDAT', 'ZLDAT', 'STRMN', 'LTRMN', 'QMDAT', 'LAUFD', 'LDDAT', 'WADAT', 'MBDAT', 'EDATU', 'EINDT', 'VDATU', 'BDATU',
         'BDTER', 'AFDAT', 'FKDAT', 'TRDAT', 'GLTGV', 'GLTGB', 'BEGDA', 'ENDDA', 'DATAB', 'DATBI', 'VBEGDAT', 'VENDDAT', 'ERDAT', 'CRDAT', 'CHDAT', 'UDATE',
         'FROM_DAT', 'TO_DAT', 'DATE_FROM', 'DATE_TO', 'VALID_FROM', 'VALID_TO', 'GBDAT', 'ADATU', 'AKTIV', 'DEAKT', 'ZUGDT', 'AFABG', 'NDABJ', 'CREDATE',
         'TDFDATE', 'TDLDATE', 'STRTDATE', 'ENDDATE', 'ERUHR_D', 'IDATE', 'AZDAT', 'KDATB', 'KDATE', 'WADAT_IST', 'KODAT', 'LFDAT_V', 'TDDAT', 'BLDAT_V',
         'FKDAT_V', 'DATUM', 'LOGDAT', 'CREDAT', 'UPDDAT', 'VALUE_DATE', 'SELDAT', 'AUSZD', 'AZDAT', 'VDATU_P', 'ENSTEHDAT', 'ERLDAT', 'AUSVN', 'AUSBS',
         'HORDA', 'NPLDA', 'LRMDT', 'ZEDAT', 'ADDAT', 'BUDAT_MKPF', 'DATUV', 'PRDAT', 'CREATED_AT', 'WT_QSSHB_DAT'}
TIMES = {'ITIME', 'ALTIME', 'STRTTIME', 'ENDTIME', 'SDLSTRTTM', 'ENTSTEZEIT', 'VEZEITERF', 'WI_CT', 'ERZET', 'CPUTM', 'LTIME', 'AEZET', 'LOGTIM', 'ERUHR', 'TIME_FROM', 'TIME_TO', 'CPUTM_MKPF', 'UTIME', 'CRETIM', 'UPDTIM', 'MZEIT', 'ISDZ', 'IEDZ', 'ERZEIT'}

def typ(t, n, fields):
    """(abap type, reference field) of field n of table t (fields: all field names of the table)."""
    if n in CUKY_F or n.startswith('WAERS'): return 'abap.cuky', None
    if n in UNIT_F: return 'abap.unit(3)', None
    if n in ('SPRAS', 'LANGU', 'TDSPRAS', 'DSPRA', 'SPRSL', 'LAISO_X'): return 'abap.lang', None
    if n in DATES or (n.endswith('DAT') and n not in ('STATU', 'KZDAT')) or n.endswith('DATU') or n.endswith('_DATE') or n.endswith('DATUM'): return 'abap.dats', None
    if n in TIMES or n.endswith('ZET') or n.endswith('UZEIT') or n.endswith('CPUTM'): return 'abap.tims', None
    if n in AMOUNT_F or re.match(r'^(KZWI\d|WT_Q.*|WRBTR.*|DMBTR.*)$', n):
        ref = next((c for c in ('WAERK', 'WAERS', 'RWCUR', 'RTCUR', 'HWAER', 'KONWA', 'RHCUR', 'CURRENCY') if c in fields), None)
        if n == 'HSL' and 'RHCUR' in fields: ref = 'RHCUR'
        if n == 'KSL' and 'RKCUR' in fields: ref = 'RKCUR'
        return ('abap.curr(15,2)', ref) if ref else ('abap.dec(15,2)', None)
    if n in QTY_F or (n.endswith('MNG') or n.endswith('MENG')):
        ref = next((c for c in ('MEINS', 'VRKME', 'ERFME', 'BSTME', 'RUNIT', 'KMEIN', 'LMEIN', 'GMEIN') if c in fields), None)
        return ('abap.quan(13,3)', ref) if ref else ('abap.dec(13,3)', None)
    if n in ('MESSWERT', 'MITTELWERT', 'SOLLWERT', 'ATFLV', 'KSTBW', 'AUSCH', 'WKURS', 'KURSF', 'MRMIN', 'MRMAX', 'KBETR', 'KPEIN', 'UKURS', 'PEINH', 'ZPRZ1', 'ZPRZ2', 'KWERT_P', 'RECDV', 'CNTRV', 'MRMIN', 'MRMAX', 'MITTELWERT', 'TOLERANZOB', 'TOLERANZUN',
             'SOLLWERT_V', 'ARBEI', 'ISMNW', 'VGW01', 'VGW02', 'VGW03', 'ISM01', 'ISM02', 'BEHAZ_D', 'PRZNT', 'KAPAZ', 'BEGZT', 'ENDZT', 'NDJAR', 'NDPER',
             'UMREZ', 'UMREN', 'BRGEW', 'NTGEW', 'VOLUM', 'PLIFZ', 'WEBAZ', 'APLFZ', 'BSTRF', 'KURSK', 'KURRF', 'BETRAG', 'ANZPAUS', 'GRWT'):
        return 'abap.dec(15,3)', None
    if n in NUMC: return f'abap.numc({NUMC[n]})', None
    if n in FLAG_F or (n.startswith('X') and len(n) <= 6 and n not in ('XBLNR', 'XREF1', 'XREF2', 'XREF3')): return 'abap.char(1)', None
    if n in CHAR: return f'abap.char({CHAR[n]})', None
    if re.search(r'TEXT|TXT|NAME|BEZ|DESCR|TITLE', n): return 'abap.char(40)', None
    if n in ('ANZBP', 'ANZSP', 'CURRDEC', 'SAKNR_LEN', 'COUNT', 'ANZAHL', 'TABIX', 'ANDEC', 'TDLTXTL', 'OBJLEN', 'ANZAL', 'MSG_CNT_AL', 'CLUSTR', 'WI_PRIO', 'ANZWERTG',
             'ANZST', 'ANZDZ', 'NGRAD', 'AZNOR', 'ABRHO', 'LANEP', 'BEHAZ', 'ANZPK', 'STUFE', 'VLAUFZ', 'NDJAR', 'NDPER', 'UFLAG'): return 'abap.int4', None
    return 'abap.char(20)', None

# ------------------------------------------------------------------ CDS names of table fields (for the views)
CDS = {'MATNR': 'Material', 'WERKS': 'Plant', 'LGORT': 'StorageLocation', 'CHARG': 'Batch', 'MEINS': 'BaseUnit', 'BUKRS': 'CompanyCode', 'GJAHR': 'FiscalYear',
       'KUNNR': 'Customer', 'LIFNR': 'Supplier', 'ERDAT': 'CreationDate', 'ERZET': 'CreationTime', 'ERNAM': 'CreatedByUser', 'AEDAT': 'LastChangeDate',
       'VKORG': 'SalesOrganization', 'VTWEG': 'DistributionChannel', 'SPART': 'Division', 'VKBUR': 'SalesOffice', 'VKGRP': 'SalesGroup', 'EKORG': 'PurchasingOrganization',
       'EKGRP': 'PurchasingGroup', 'WAERK': 'TransactionCurrency', 'WAERS': 'Currency', 'NETWR': 'NetAmount', 'NETPR': 'NetPriceAmount', 'ZTERM': 'PaymentTerms',
       'INCO1': 'IncotermsClassification', 'INCO2': 'IncotermsTransferLocation', 'KOSTL': 'CostCenter', 'PRCTR': 'ProfitCenter', 'AUFNR': 'OrderID', 'KOKRS': 'ControllingArea',
       'SAKNR': 'GLAccount', 'HKONT': 'GLAccount', 'RACCT': 'GLAccount', 'BUDAT': 'PostingDate', 'BLDAT': 'DocumentDate', 'XBLNR': 'DocumentReferenceID',
       'BKTXT': 'AccountingDocumentHeaderText', 'SGTXT': 'DocumentItemText', 'BWART': 'GoodsMovementType', 'SHKZG': 'DebitCreditCode', 'MENGE': 'Quantity',
       'ERFMG': 'QuantityInEntryUnit', 'ERFME': 'EntryUnit', 'DMBTR': 'AmountInCompanyCodeCurrency', 'WRBTR': 'AmountInTransactionCurrency', 'MWSKZ': 'TaxCode',
       'MATKL': 'MaterialGroup', 'TXZ01': 'PurchaseOrderItemText', 'ARKTX': 'SalesDocumentItemText', 'PSTYV': 'SalesDocumentItemCategory', 'AUART': 'SalesDocumentType',
       'VBTYP': 'SDDocumentCategory', 'AUDAT': 'SalesDocumentDate', 'BSTNK': 'PurchaseOrderByCustomer', 'BSTDK': 'CustomerPurchaseOrderDate', 'VDATU': 'RequestedDeliveryDate',
       'KNUMV': 'PricingDocument', 'LIFSK': 'DeliveryBlockReason', 'FAKSK': 'HeaderBillingBlockReason', 'GBSTK': 'OverallSDProcessStatus', 'LFSTK': 'OverallDeliveryStatus',
       'FKSTK': 'OverallBillingStatus', 'AUGRU': 'SDDocumentReason', 'VSBED': 'ShippingCondition', 'KWMENG': 'OrderQuantity', 'VRKME': 'OrderQuantityUnit',
       'ABGRU': 'SalesDocumentRjcnReason', 'VSTEL': 'ShippingPoint', 'ROUTE': 'Route', 'UEPOS': 'HigherLevelItem', 'VGBEL': 'ReferenceSDDocument', 'VGPOS': 'ReferenceSDDocumentItem',
       'GBSTA': 'SDProcessStatus', 'LFSTA': 'DeliveryStatus', 'FKSAA': 'OrderRelatedBillingStatus', 'EDATU': 'RequestedDeliveryDate', 'WMENG': 'ScheduleLineOrderQuantity',
       'BMENG': 'ConfdOrderQtyByMatlAvailCheck', 'LMENG': 'RequiredQuantity', 'ETTYP': 'ScheduleLineCategory', 'MBDAT': 'ProductAvailabilityDate', 'WADAT': 'GoodsIssueDate',
       'LDDAT': 'LoadingDate', 'PARVW': 'PartnerFunction', 'ADRNR': 'AddressID', 'PERNR': 'Personnel', 'LFART': 'DeliveryDocumentType', 'LFDAT': 'DeliveryDate',
       'WADAT_IST': 'ActualGoodsMovementDate', 'KUNAG': 'SoldToParty', 'BTGEW': 'HeaderGrossWeight', 'NTGEW': 'NetWeight', 'GEWEI': 'WeightUnit', 'LFIMG': 'ActualDeliveryQuantity',
       'LGMNG': 'ActualDeliveredQtyInBaseUnit', 'WBSTA': 'GoodsMovementStatus', 'KOSTK': 'OverallPickingStatus', 'FKART': 'BillingDocumentType', 'FKDAT': 'BillingDocumentDate',
       'FKIMG': 'BillingQuantity', 'MWSBK': 'TaxAmount', 'MWSBP': 'TaxAmount', 'KUNRG': 'PayerParty', 'BELNR': 'AccountingDocument', 'RFBSK': 'AccountingTransferStatus',
       'FKSTO': 'BillingDocumentIsCancelled', 'SFAKN': 'CancelledBillingDocument', 'KSCHL': 'ConditionType', 'KBETR': 'ConditionRateValue', 'KWERT': 'ConditionAmount',
       'KPEIN': 'ConditionQuantity', 'KMEIN': 'ConditionQuantityUnit', 'KAWRT': 'ConditionBaseValue', 'KINAK': 'ConditionInactiveReason', 'KSTAT': 'ConditionIsForStatistics',
       'KNUMH': 'ConditionRecord', 'BSART': 'PurchaseOrderType', 'BSTYP': 'PurchasingDocumentCategory', 'BEDAT': 'PurchaseOrderDate', 'LOEKZ': 'PurchasingDocumentDeletionCode',
       'STATU': 'PurchasingDocumentStatus', 'FRGKE': 'ReleaseCode', 'PEINH': 'NetPriceQuantity', 'BRTWR': 'GrossAmount', 'PSTYP': 'PurchaseOrderItemCategory',
       'KNTTP': 'AccountAssignmentCategory', 'ELIKZ': 'IsCompletelyDelivered', 'EREKZ': 'IsFinallyInvoiced', 'WEPOS': 'GoodsReceiptIsExpected',
       'REPOS': 'InvoiceIsExpected', 'WEBRE': 'InvoiceIsGoodsReceiptBased', 'BANFN': 'PurchaseRequisition', 'BNFPO': 'PurchaseRequisitionItem', 'INFNR': 'PurchasingInfoRecord',
       'EINDT': 'ScheduleLineDeliveryDate', 'WEMNG': 'RoughGoodsReceiptQty', 'BEWTP': 'PurchasingHistoryCategory', 'LFBNR': 'ReferenceDocument', 'LFGJA': 'ReferenceDocumentFiscalYear',
       'LFPOS': 'ReferenceDocumentItem', 'SAKTO': 'GLAccount', 'PS_PSP_PNR': 'WBSElementInternalID', 'ANLN1': 'MasterFixedAsset', 'ANLN2': 'FixedAsset',
       'BADAT': 'PurchaseRequisitionReleaseDate', 'FRGKZ': 'PurReqnReleaseStatus', 'FLIEF': 'FixedSupplier', 'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem',
       'MJAHR': 'MaterialDocumentYear', 'MBLNR': 'MaterialDocument', 'ZEILE': 'MaterialDocumentItem', 'SOBKZ': 'InventorySpecialStockType', 'KDAUF': 'SalesOrder',
       'KDPOS': 'SalesOrderItem', 'CPUDT': 'CreationDate', 'CPUTM': 'CreationTime', 'USNAM': 'CreatedByUser', 'RSNUM': 'Reservation', 'RSPOS': 'ReservationItem',
       'VBELN_IM': 'DeliveryDocument', 'VBELP_IM': 'DeliveryDocumentItem', 'SMBLN': 'ReversedMaterialDocument', 'SMBLP': 'ReversedMaterialDocumentItem',
       'SJAHR': 'ReversedMaterialDocumentYear', 'STOCK_QTY': 'MatlWrhsStkQtyInMatlBaseUnit', 'BDMNG': 'ResvnItmRequiredQtyInBaseUnit', 'ENMNG': 'ResvnItmWithdrawnQtyInBaseUnit',
       'BDTER': 'MatlCompRequirementDate', 'XLOEK': 'ReservationItemIsMarkedForDeltn', 'KZEAR': 'ReservationItemIsFinallyIssued', 'RLDNR': 'Ledger', 'RBUKRS': 'CompanyCode',
       'DOCLN': 'LedgerGLLineItem', 'BUZEI': 'AccountingDocumentItem', 'KTOPL': 'ChartOfAccounts', 'BLART': 'AccountingDocumentType', 'POPER': 'FiscalPeriod',
       'DRCRK': 'DebitCreditCode', 'TSL': 'AmountInTransactionCurrency', 'RTCUR': 'TransactionCurrency', 'RWCUR': 'TransactionCurrency', 'HSL': 'AmountInCompanyCodeCurrency',
       'RHCUR': 'CompanyCodeCurrency', 'KSL': 'AmountInGlobalCurrency', 'RKCUR': 'GlobalCurrency', 'MSL': 'Quantity', 'RUNIT': 'BaseUnit', 'RCNTR': 'CostCenter',
       'SEGMENT': 'Segment', 'BSCHL': 'PostingKey', 'KOART': 'FinancialAccountType', 'AWTYP': 'ReferenceDocumentType', 'AWREF': 'ReferenceDocument',
       'AWORG': 'ReferenceDocumentContext', 'AUGBL': 'ClearingJournalEntry', 'AUGDT': 'ClearingDate', 'ZUONR': 'AssignmentReference', 'ZFBDT': 'DueCalculationBaseDate',
       'VBELN': 'SalesDocument', 'POSNR': 'SalesDocumentItem', 'MONAT': 'FiscalPeriod', 'TCODE': 'TransactionCode', 'STBLG': 'ReverseDocument', 'BSTAT': 'AccountingDocumentCategory',
       'HWAER': 'CompanyCodeCurrency', 'KURSF': 'ExchangeRate', 'ANLKL': 'AssetClass', 'TXT50': 'FixedAssetDescription', 'INVNR': 'InventoryNumber', 'AKTIV': 'AssetCapitalizationDate',
       'DEAKT': 'AssetDeactivationDate', 'EQUNR': 'Equipment', 'EQTYP': 'EquipmentCategory', 'EQART': 'TechnicalObjectType', 'HERST': 'AssetManufacturerName',
       'SERGE': 'ManufacturerSerialNumber', 'SERNR': 'SerialNumber', 'BAUJJ': 'ConstructionYear', 'OBJNR': 'MaintObjectInternalID', 'INBDT': 'StartupDate',
       'TPLNR': 'FunctionalLocation', 'FLTYP': 'FunctionalLocationCategory', 'IWERK': 'MaintenancePlanningPlant', 'SWERK': 'MaintenancePlant', 'QMNUM': 'MaintenanceNotification',
       'QMART': 'NotificationType', 'QMTXT': 'NotificationText', 'QMDAT': 'NotificationCreationDate', 'PRIOK': 'MaintPriority', 'WARPL': 'MaintenancePlan',
       'WAPOS': 'MaintenanceItem', 'STRAT': 'MaintenanceStrategy', 'PRUEFLOS': 'InspectionLot', 'ART': 'InspectionLotType', 'HERKUNFT': 'InspectionLotOrigin',
       'LOSMENGE': 'InspectionLotQuantity', 'MERKNR': 'InspectionCharacteristic', 'VORGLFNR': 'InspPlanOperationInternalID', 'VCODE': 'InspLotUsageDecisionCode',
       'VDATUM': 'InspLotUsageDecisionDate', 'AUTYP': 'OrderCategory', 'KTEXT': 'OrderDescription', 'GAMNG': 'TotalQuantity', 'GMEIN': 'ProductionUnit',
       'GSTRP': 'MfgOrderPlannedStartDate', 'GLTRP': 'MfgOrderPlannedEndDate', 'PSMNG': 'MfgOrderPlannedTotalQty', 'WEMNG_P': 'MfgOrderItemGoodsReceiptQty',
       'AUFPL': 'OrderInternalBillOfOperations', 'APLZL': 'OrderOperationInternalID', 'VORNR': 'ManufacturingOrderOperation', 'ARBID': 'WorkCenterInternalID',
       'LTXA1': 'MfgOrderOperationText', 'RUECK': 'MfgOrderConfirmationGroup', 'RMZHL': 'MfgOrderConfirmation', 'LMNGA': 'ConfirmationYieldQuantity',
       'XMNGA': 'ConfirmationScrapQuantity', 'ISM01': 'OpWorkQuantity1', 'PLNUM': 'PlannedOrder', 'PAART': 'PlannedOrderType', 'PSTTR': 'PlannedOrderStartDate',
       'PEDTR': 'PlannedOrderEndDate', 'VERID': 'ProductionVersion', 'TEXT1': 'ProductionVersionText', 'ADATU': 'ValidityStartDate', 'BDATU': 'ValidityEndDate',
       'STLAN': 'BillOfMaterialVariantUsage', 'STLNR': 'BillOfMaterial', 'STLAL': 'BillOfMaterialVariant', 'STLTY': 'BillOfMaterialCategory', 'STLKN': 'BillOfMaterialItemNodeNumber',
       'STPOZ': 'BOMItemInternalChangeCount', 'IDNRK': 'BillOfMaterialComponent', 'POSTP': 'BillOfMaterialItemCategory', 'BMENG_B': 'BOMHeaderBaseUnit',
       'PSPNR': 'WBSElementInternalID', 'POSID': 'WBSElement', 'PSPHI': 'ProjectInternalID', 'PSPID': 'Project', 'POST1': 'ProjectDescription', 'OBJTY': 'WorkCenterTypeCode',
       'OBJID': 'WorkCenterInternalID', 'ARBPL': 'WorkCenter', 'VERWE': 'WorkCenterCategoryCode', 'ATINN': 'CharcInternalID', 'ATNAM': 'Characteristic',
       'CLINT': 'ClassInternalID', 'CLASS': 'Class', 'KLART': 'ClassType', 'OBJECTCLAS': 'ChangeDocObjectClass', 'OBJECTID': 'ChangeDocObject', 'CHANGENR': 'ChangeDocument',
       'UDATE': 'CreationDate', 'UTIME': 'CreationTime', 'USERNAME': 'CreatedByUser', 'TABNAME': 'DatabaseTable', 'TABKEY': 'ChangeDocTableKey', 'FNAME': 'ChangeDocDatabaseTableField',
       'CHNGIND': 'ChangeDocItemChangeType', 'VALUE_NEW': 'ChangeDocNewFieldValue', 'VALUE_OLD': 'ChangeDocPreviousFieldValue', 'BNAME': 'UserID', 'USTYP': 'UserType',
       'GLTGV': 'ValidityStartDate', 'GLTGB': 'ValidityEndDate', 'UFLAG': 'UserLockStatus', 'TRDAT': 'LastLogonDate', 'PERSNUMBER': 'PersonID', 'PARTNER': 'BusinessPartner',
       'ADDRNUMBER': 'AddressID', 'ADR_KIND': 'AddressUsage', 'VALID_FROM': 'ValidityStartDate', 'VALID_TO': 'ValidityEndDate', 'BKVID': 'BankIdentification',
       'BANKS': 'BankCountryKey', 'BANKL': 'BankNumber', 'BANKN': 'BankAccount', 'IBAN': 'IBAN', 'NAME': 'SegmentName', 'NAME1': 'Name', 'ESOKZ': 'PurchasingInfoRecordCategory',
       'APLFZ': 'MaterialPlannedDeliveryDurn', 'NORBM': 'StandardPurchaseOrderQuantity', 'MINBM': 'MinimumPurchaseOrderQuantity', 'IDNLF': 'SupplierMaterialNumber',
       'ZEORD': 'SourceListRecord', 'VDATU_S': 'ValidityStartDate', 'FLIFN': 'SupplierIsFixed', 'NOTKZ': 'SourceOfSupplyIsBlocked', 'RMWWR': 'InvoiceGrossAmount',
       'WMWST1': 'TaxAmount', 'RBSTAT': 'SupplierInvoiceStatus', 'BSTME': 'PurchaseOrderQuantityUnit', 'ZEKKN': 'AccountAssignmentNumber', 'VGABE': 'PurchasingHistoryDocumentType',
       'ETENR': 'ScheduleLine', 'RFMNG': 'QuantityInBaseUnit', 'RFWRT': 'NetAmount', 'STUNR': 'PricingProcedureStep', 'ZAEHK': 'PricingProcedureCounter',
       'KPOSN': 'SalesOrderItem', 'BTEXT': 'GoodsMovementTypeName', 'RESOURCE': 'Resource'}

# views: name -> (table, label, {table key: CDS name} for the keys (else the documents' key names, in order), where, {field: CDS name} overrides)
VIEWS_SPEC = {
    'I_SalesDocument': ('vbak', 'Sales Document', {'VBELN': 'SalesDocument'}, None, {}),
    'I_SalesDocumentItem': ('vbap', 'Sales Document Item', {'VBELN': 'SalesDocument', 'POSNR': 'SalesDocumentItem'}, None, {}),
    'I_SalesOrder': ('vbak', 'Sales Order', {'VBELN': 'SalesOrder'}, "vbtyp = 'C'", {'NETWR': 'TotalNetAmount', 'AUART': 'SalesOrderType', 'AUDAT': 'SalesOrderDate', 'KUNNR': 'SoldToParty'}),
    'I_SalesOrderItem': ('vbap', 'Sales Order Item', {'VBELN': 'SalesOrder', 'POSNR': 'SalesOrderItem'}, None, {'ARKTX': 'SalesOrderItemText', 'PSTYV': 'SalesOrderItemCategory'}),
    'I_SalesOrderScheduleLine': ('vbep', 'Sales Order Schedule Line', {'VBELN': 'SalesOrder', 'POSNR': 'SalesOrderItem', 'ETENR': 'ScheduleLine'}, None, {}),
    'I_SalesOrderPartner': ('vbpa', 'Sales Order Partner', {'VBELN': 'SalesOrder', 'POSNR': 'SalesOrderItem', 'PARVW': 'PartnerFunction'}, 'posnr = \'000000\'', {}),
    'I_SalesOrderItemPricingElement': ('prcd_elements', 'Sales Order Item Pricing Element', {'KNUMV': 'PricingDocument', 'KPOSN': 'SalesOrderItem', 'STUNR': 'PricingProcedureStep', 'ZAEHK': 'PricingProcedureCounter'}, None, {}),
    'I_BillingDocumentItemPrcgElmnt': ('prcd_elements', 'Billing Document Item Pricing Element', {'KNUMV': 'PricingDocument', 'KPOSN': 'BillingDocumentItem', 'STUNR': 'PricingProcedureStep', 'ZAEHK': 'PricingProcedureCounter'}, None, {}),
    'I_SDDocumentProcessFlow': ('vbfa', 'SD Document Process Flow', {'RUUID': 'DocRelationshipUUID'}, None, {'VBELV': 'PrecedingDocument', 'POSNV': 'PrecedingDocumentItem', 'VBTYP_V': 'PrecedingDocumentCategory', 'VBELN': 'SubsequentDocument', 'POSNN': 'SubsequentDocumentItem', 'VBTYP_N': 'SubsequentDocumentCategory', 'RFMNG': 'QuantityInBaseUnit', 'MEINS': 'BaseUnit', 'RFWRT': 'NetAmount', 'WAERS': 'StatisticsCurrency', 'ERDAT': 'CreationDate'}),
    'I_SDDocumentMultiLevelProcFlow': ('vbfa', 'SD Document Multi-Level Process Flow', {'RUUID': 'DocRelationshipUUID'}, None, {'VBELV': 'PrecedingDocument', 'POSNV': 'PrecedingDocumentItem', 'VBTYP_V': 'PrecedingDocumentCategory', 'VBELN': 'SubsequentDocument', 'POSNN': 'SubsequentDocumentItem', 'VBTYP_N': 'SubsequentDocumentCategory'}),
    'I_DeliveryDocument': ('likp', 'Delivery Document', {'VBELN': 'DeliveryDocument'}, None, {'KUNNR': 'ShipToParty'}),
    'I_DeliveryDocumentItem': ('lips', 'Delivery Document Item', {'VBELN': 'DeliveryDocument', 'POSNR': 'DeliveryDocumentItem'}, None, {'ARKTX': 'DeliveryDocumentItemText', 'PSTYV': 'DeliveryDocumentItemCategory'}),
    'I_BillingDocument': ('vbrk', 'Billing Document', {'VBELN': 'BillingDocument'}, None, {'NETWR': 'TotalNetAmount', 'KUNAG': 'SoldToParty'}),
    'I_BillingDocumentItem': ('vbrp', 'Billing Document Item', {'VBELN': 'BillingDocument', 'POSNR': 'BillingDocumentItem'}, None, {'ARKTX': 'BillingDocumentItemText', 'AUBEL': 'SalesDocument', 'AUPOS': 'SalesDocumentItem'}),
    'I_PurchaseRequisitionItem': ('eban', 'Purchase Requisition Item', {'BANFN': 'PurchaseRequisition', 'BNFPO': 'PurchaseRequisitionItem'}, None, {'BSART': 'PurchaseRequisitionType', 'MENGE': 'RequestedQuantity', 'LFDAT': 'DeliveryDate', 'TXZ01': 'PurchaseRequisitionItemText'}),
    'I_PurchaseRequisitionItemAPI01': ('eban', 'Purchase Requisition Item (API)', {'BANFN': 'PurchaseRequisition', 'BNFPO': 'PurchaseRequisitionItem'}, None, {'BSART': 'PurchaseRequisitionType', 'MENGE': 'RequestedQuantity', 'LFDAT': 'DeliveryDate', 'TXZ01': 'PurchaseRequisitionItemText'}),
    'I_PurchaseOrderAPI01': ('ekko', 'Purchase Order (API)', {'EBELN': 'PurchaseOrder'}, None, {'AEDAT': 'CreationDate'}),
    'I_PurchaseOrderItemAPI01': ('ekpo', 'Purchase Order Item (API)', {'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem'}, None, {'MENGE': 'OrderQuantity', 'MEINS': 'PurchaseOrderQuantityUnit', 'NETWR': 'NetAmount', 'BRTWR': 'GrossAmount'}),
    'I_PurchaseOrderScheduleLineAPI01': ('eket', 'Purchase Order Schedule Line (API)', {'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem', 'ETENR': 'ScheduleLine'}, None, {'MENGE': 'ScheduleLineOrderQuantity'}),
    'I_PurOrdScheduleLineAPI01': ('eket', 'Purchase Order Schedule Line (API)', {'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem', 'ETENR': 'ScheduleLine'}, None, {'MENGE': 'ScheduleLineOrderQuantity'}),
    'I_PurOrdAccountAssignmentAPI01': ('ekkn', 'Purchase Order Account Assignment (API)', {'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem', 'ZEKKN': 'AccountAssignmentNumber'}, None, {}),
    'I_PurchaseOrderHistoryAPI01': ('ekbe', 'Purchase Order History (API)', {'EBELN': 'PurchaseOrder', 'EBELP': 'PurchaseOrderItem', 'ZEKKN': 'AccountAssignmentNumber', 'VGABE': 'PurchasingHistoryDocumentType', 'GJAHR': 'PurchasingHistoryDocumentYear', 'BELNR': 'PurchasingHistoryDocument', 'BUZEI': 'PurchasingHistoryDocumentItem'}, None, {'BUDAT': 'PostingDate', 'DMBTR': 'PurOrdAmountInCompanyCodeCrcy', 'WRBTR': 'PurchaseOrderAmount'}),
    'I_PurchasingInfoRecordApi01': ('eina', 'Purchasing Info Record (API)', {'INFNR': 'PurchasingInfoRecord'}, None, {}),
    'I_PurgInfoRecdOrgPlantDataApi01': ('eine', 'Purchasing Info Record Org Plant Data (API)', {'INFNR': 'PurchasingInfoRecord', 'ESOKZ': 'PurchasingInfoRecordCategory', 'EKORG': 'PurchasingOrganization', 'WERKS': 'Plant'}, None, {}),
    'I_PurchasingSourceList': ('eord', 'Purchasing Source List', {'MATNR': 'Material', 'WERKS': 'Plant', 'ZEORD': 'SourceListRecord'}, None, {'VDATU': 'ValidityStartDate', 'BDATU': 'ValidityEndDate'}),
    'I_SupplierInvoiceAPI01': ('rbkp', 'Supplier Invoice (API)', {'BELNR': 'SupplierInvoice', 'GJAHR': 'FiscalYear'}, None, {'LIFNR': 'InvoicingParty', 'XBLNR': 'SupplierInvoiceIDByInvcgParty'}),
    'I_SuplrInvcItemPurOrdRefAPI01': ('rseg', 'Supplier Invoice Item with Purchase Order Reference (API)', {'BELNR': 'SupplierInvoice', 'GJAHR': 'FiscalYear', 'BUZEI': 'SupplierInvoiceItem'}, None, {'WRBTR': 'SupplierInvoiceItemAmount', 'MENGE': 'QuantityInPurchaseOrderUnit'}),
    'I_MaterialDocumentHeader_2': ('matdoc', 'Material Document Header', {'MJAHR': 'MaterialDocumentYear', 'MBLNR': 'MaterialDocument'}, "zeile = '0001'", {}),
    'I_MaterialDocumentItem_2': ('matdoc', 'Material Document Item', {'MJAHR': 'MaterialDocumentYear', 'MBLNR': 'MaterialDocument', 'ZEILE': 'MaterialDocumentItem'}, None, {'MENGE': 'QuantityInBaseUnit', 'MEINS': 'MaterialBaseUnit'}),
    'I_Reservation': ('rkpf', 'Reservation', {'RSNUM': 'Reservation'}, None, {}),
    'I_ReservationDocumentItem': ('resb', 'Reservation Document Item', {'RSNUM': 'Reservation', 'RSPOS': 'ReservationItem', 'RSART': 'RecordType'}, None, {}),
    'I_Batch': ('mch1', 'Batch', {'MATNR': 'Material', 'CHARG': 'Batch'}, None, {}),
    'I_JournalEntry': ('bkpf', 'Journal Entry', {'BUKRS': 'CompanyCode', 'GJAHR': 'FiscalYear', 'BELNR': 'AccountingDocument'}, None, {'USNAM': 'AccountingDocCreatedByUser', 'CPUDT': 'AccountingDocumentCreationDate'}),
    'I_JournalEntryItem': ('acdoca', 'Journal Entry Item', {'RLDNR': 'Ledger', 'RBUKRS': 'CompanyCode', 'GJAHR': 'FiscalYear', 'BELNR': 'AccountingDocument', 'DOCLN': 'LedgerGLLineItem'}, None, {'KUNNR': 'Customer', 'LIFNR': 'Supplier', 'MATNR': 'Material', 'WERKS': 'Plant', 'AUFNR': 'OrderID', 'VBELN': 'SalesDocument', 'POSNR': 'SalesDocumentItem'}),
    'I_GLAccountLineItem': ('acdoca', 'G/L Account Line Item', {'RLDNR': 'Ledger', 'RBUKRS': 'CompanyCode', 'GJAHR': 'FiscalYear', 'BELNR': 'AccountingDocument', 'DOCLN': 'LedgerGLLineItem'}, None, {}),
    'I_OperationalAcctgDocItem': ('bseg', 'Operational Accounting Document Item', {'BUKRS': 'CompanyCode', 'BELNR': 'AccountingDocument', 'GJAHR': 'FiscalYear', 'BUZEI': 'AccountingDocumentItem'}, None, {}),
    'I_Ledger': ('finsc_ledger', 'Ledger', {'RLDNR': 'Ledger'}, None, {}),
    'I_Segment': ('fagl_segm', 'Segment', {'SEGMENT': 'Segment'}, None, {}),
    'I_FiscalYearPeriodForVariant': ('t009b', 'Fiscal Year Period for Fiscal Year Variant', {'PERIV': 'FiscalYearVariant', 'BDATJ': 'CalendarYear', 'BUMON': 'CalendarMonth', 'BUTAG': 'CalendarDay'}, None, {'POPER': 'FiscalPeriod', 'RELJR': 'FiscalYearShift'}),
    'I_GLAccountTextRawData': ('skat', 'G/L Account Text (Raw Data)', {'KTOPL': 'ChartOfAccounts', 'SAKNR': 'GLAccount', 'SPRAS': 'Language'}, None, {'TXT20': 'GLAccountName', 'TXT50': 'GLAccountLongName'}),
    'I_GLAcctBalanceCube': ('acdoca', 'G/L Account Balance', None, 'group by rldnr, rbukrs, gjahr, poper, racct, rhcur', None),
    'I_InternalOrder': ('aufk', 'Internal Order', {'AUFNR': 'InternalOrder'}, "autyp = '01'", {'AUART': 'OrderType', 'KTEXT': 'InternalOrderDescription'}),
    'I_ManufacturingOrder': ('afko', 'Manufacturing Order', {'AUFNR': 'ManufacturingOrder'}, None, {'GSTRP': 'MfgOrderPlannedStartDate', 'GLTRP': 'MfgOrderPlannedEndDate', 'GAMNG': 'MfgOrderPlannedTotalQty', 'GMEIN': 'ProductionUnit', 'PLNBEZ': 'Material'}),
    'I_ManufacturingOrderItem': ('afpo', 'Manufacturing Order Item', {'AUFNR': 'ManufacturingOrder', 'POSNR': 'ManufacturingOrderItem'}, None, {'PSMNG': 'MfgOrderItemPlannedTotalQty', 'WEMNG': 'MfgOrderItemGoodsReceiptQty', 'PWERK': 'ProductionPlant'}),
    'I_ManufacturingOrderOperation': ('afvc', 'Manufacturing Order Operation', {'AUFPL': 'OrderInternalBillOfOperations', 'APLZL': 'OrderOperationInternalID'}, None, {}),
    'I_MfgOrderConfirmation': ('afru', 'Manufacturing Order Confirmation', {'RUECK': 'MfgOrderConfirmationGroup', 'RMZHL': 'MfgOrderConfirmation'}, None, {'AUFNR': 'ManufacturingOrder'}),
    'I_PlannedOrder': ('plaf', 'Planned Order', {'PLNUM': 'PlannedOrder'}, None, {'MATNR': 'Material', 'PLWRK': 'MRPPlant', 'GSMNG': 'TotalQuantity'}),
    'I_ProductionVersion': ('mkal', 'Production Version', {'MATNR': 'Material', 'WERKS': 'Plant', 'VERID': 'ProductionVersion'}, None, {}),
    'I_MaterialBOMLink': ('mast', 'Material BOM Link', {'MATNR': 'Material', 'WERKS': 'Plant', 'STLAN': 'BillOfMaterialVariantUsage', 'STLNR': 'BillOfMaterial', 'STLAL': 'BillOfMaterialVariant'}, None, {}),
    'I_BillOfMaterial': ('stko', 'Bill of Material', {'STLTY': 'BillOfMaterialCategory', 'STLNR': 'BillOfMaterial', 'STLAL': 'BillOfMaterialVariant', 'STKOZ': 'BOMHeaderInternalChangeCount'}, None, {'BMENG': 'BOMHeaderQuantityInBaseUnit', 'BMEIN': 'BOMHeaderBaseUnit'}),
    'I_BillOfMaterialItemBasic': ('stpo', 'Bill of Material Item', {'STLTY': 'BillOfMaterialCategory', 'STLNR': 'BillOfMaterial', 'STLKN': 'BillOfMaterialItemNodeNumber', 'STPOZ': 'BOMItemInternalChangeCount'}, None, {'MENGE': 'BillOfMaterialItemQuantity', 'MEINS': 'BillOfMaterialItemUnit', 'POSNR': 'BillOfMaterialItemNumber'}),
    'I_WorkCenter': ('crhd', 'Work Center', {'OBJTY': 'WorkCenterTypeCode', 'OBJID': 'WorkCenterInternalID'}, None, {}),
    'I_MaintenanceOrder': ('aufk', 'Maintenance Order', {'AUFNR': 'MaintenanceOrder'}, "autyp = '30'", {'AUART': 'MaintenanceOrderType', 'KTEXT': 'MaintenanceOrderDesc'}),
    'I_MaintenanceNotification': ('qmel', 'Maintenance Notification', {'QMNUM': 'MaintenanceNotification'}, None, {}),
    'I_MaintenancePlan': ('mpla', 'Maintenance Plan', {'WARPL': 'MaintenancePlan'}, None, {'WPTXT': 'MaintenancePlanDesc'}),
    'I_MaintenanceItem': ('mpos', 'Maintenance Item', {'WAPOS': 'MaintenanceItem'}, None, {'PSTXT': 'MaintenanceItemDescription'}),
    'I_Equipment': ('equi', 'Equipment', {'EQUNR': 'Equipment'}, None, {}),
    'I_FunctionalLocation': ('iflot', 'Functional Location', {'TPLNR': 'FunctionalLocation'}, None, {}),
    'I_InspectionLot': ('qals', 'Inspection Lot', {'PRUEFLOS': 'InspectionLot'}, None, {}),
    'I_InspectionCharacteristic': ('qamv', 'Inspection Characteristic', {'PRUEFLOS': 'InspectionLot', 'VORGLFNR': 'InspPlanOperationInternalID', 'MERKNR': 'InspectionCharacteristic'}, None, {'KURZTEXT': 'InspectionSpecificationText'}),
    'I_InspectionResult': ('qamr', 'Inspection Result', {'PRUEFLOS': 'InspectionLot', 'VORGLFNR': 'InspPlanOperationInternalID', 'MERKNR': 'InspectionCharacteristic'}, None, {'MITTELWERT': 'InspectionResultMeanValue'}),
    'I_InspLotUsageDecision': ('qave', 'Inspection Lot Usage Decision', {'PRUEFLOS': 'InspectionLot', 'KZART': 'InspLotUsageDecisionCategory', 'ZAEHLER': 'InspLotUsageDecisionCounter'}, None, {}),
    'I_Project': ('proj', 'Project', {'PSPNR': 'ProjectInternalID'}, None, {}),
    'I_EnterpriseProject': ('proj', 'Enterprise Project', {'PSPNR': 'ProjectInternalID'}, None, {}),
    'I_WBSElement': ('prps', 'WBS Element', {'PSPNR': 'WBSElementInternalID'}, None, {'POST1': 'WBSDescription'}),
    'I_WBSElementBasicData': ('prps', 'WBS Element Basic Data', {'PSPNR': 'WBSElementInternalID'}, None, {'POST1': 'WBSDescription'}),
    'I_AssetClass': ('anka', 'Asset Class', {'ANLKL': 'AssetClass'}, None, {}),
    'I_FixedAsset': ('anla', 'Fixed Asset', {'BUKRS': 'CompanyCode', 'ANLN1': 'MasterFixedAsset', 'ANLN2': 'FixedAsset'}, None, {}),
    'I_FixedAssetAssgmt': ('anlz', 'Fixed Asset Assignment', {'BUKRS': 'CompanyCode', 'ANLN1': 'MasterFixedAsset', 'ANLN2': 'FixedAsset', 'BDATU': 'ValidityEndDate'}, None, {'ADATU': 'ValidityStartDate'}),
    'I_ChangeDocument': ('cdhdr', 'Change Document', {'OBJECTCLAS': 'ChangeDocObjectClass', 'OBJECTID': 'ChangeDocObject', 'CHANGENR': 'ChangeDocument'}, None, {}),
    'I_ChangeDocumentItem': ('cdpos', 'Change Document Item', {'OBJECTCLAS': 'ChangeDocObjectClass', 'OBJECTID': 'ChangeDocObject', 'CHANGENR': 'ChangeDocument', 'TABNAME': 'DatabaseTable', 'TABKEY': 'ChangeDocTableKey', 'FNAME': 'ChangeDocDatabaseTableField', 'CHNGIND': 'ChangeDocItemChangeType'}, None, {}),
    'I_User': ('usr02', 'User', {'BNAME': 'UserID'}, None, {}),
    'I_BusinessUser': ('usr21', 'Business User', {'BNAME': 'UserID'}, None, {}),
    'I_BusinessPartnerAddress': ('but020', 'Business Partner Address', {'PARTNER': 'BusinessPartner', 'ADDRNUMBER': 'AddressID'}, None, {}),
    'I_BusinessPartnerAddressUsage': ('but021_fs', 'Business Partner Address Usage', {'PARTNER': 'BusinessPartner', 'ADR_KIND': 'AddressUsage', 'VALID_TO': 'ValidityEndDate'}, None, {}),
    'I_BusinessPartnerBank': ('but0bk', 'Business Partner Bank', {'PARTNER': 'BusinessPartner', 'BKVID': 'BankIdentification'}, None, {}),
    'I_Material': ('mara', 'Material', {'MATNR': 'Material'}, None, {'MTART': 'MaterialType', 'MATKL': 'MaterialGroup', 'MEINS': 'MaterialBaseUnit'}),
    'I_ProductPlant': ('marc', 'Product Plant', {'MATNR': 'Product', 'WERKS': 'Plant'}, None, {}),
}
AGG = {   # aggregating views: (table, label, [(expr, alias, key)], group by)
    'I_GLAcctBalanceCube': ('acdoca', 'G/L Account Balance', [('rldnr', 'Ledger', True), ('rbukrs', 'CompanyCode', True), ('gjahr', 'FiscalYear', True), ('poper', 'FiscalPeriod', True),
                            ('racct', 'GLAccount', True), ('rhcur', 'CompanyCodeCurrency', True), ('sum(hsl)', 'AmountInCompanyCodeCurrency', False), ('count(*)', 'NumberOfLineItems', False)],
                            'group by rldnr, rbukrs, gjahr, poper, racct, rhcur'),
    'I_MaterialStock_2': ('matdoc', 'Material Stock', [('matnr', 'Material', True), ('werks', 'Plant', True), ('lgort', 'StorageLocation', True), ('charg', 'Batch', True),
                          ('sobkz', 'InventorySpecialStockType', True), ('meins', 'MaterialBaseUnit', True), ('sum(stock_qty)', 'MatlWrhsStkQtyInMatlBaseUnit', False)],
                          'group by matnr, werks, lgort, charg, sobkz, meins'),
    'I_StockQuantityCurrentValue_2': ('matdoc_extract', 'Stock Quantity and Value', [('matnr', 'Product', True), ('werks', 'Plant', True), ('lgort', 'StorageLocation', True),
                                      ('charg', 'Batch', True), ('meins', 'MaterialBaseUnit', True), ('waers', 'Currency', True), ('sum(stock_qty)', 'MatlWrhsStkQtyInMatlBaseUnit', False),
                                      ('sum(value_lc)', 'StockValueInCCCrcy', False)], 'group by matnr, werks, lgort, charg, meins, waers'),
}
# compatibility views of S/4 (old tables read from the new ones)
COMPAT = {
    'MKPF': ('matdoc', 'Material document header (compatibility view of MATDOC)', [('mblnr', 'mblnr', True), ('mjahr', 'mjahr', True), ('budat', 'budat', False), ('bldat', 'bldat', False),
             ('cpudt', 'cpudt', False), ('cputm', 'cputm', False), ('usnam', 'usnam', False), ('xblnr', 'xblnr', False), ('bktxt', 'bktxt', False), ('vgart', 'vgart', False)], "zeile = '0001'"),
    'MSEG': ('matdoc', 'Material document item (compatibility view of MATDOC)', [(c, c, c in ('mblnr', 'mjahr', 'zeile')) for c in ('mblnr', 'mjahr', 'zeile', 'bwart', 'matnr', 'werks',
             'lgort', 'charg', 'sobkz', 'lifnr', 'kunnr', 'kdauf', 'kdpos', 'shkzg', 'menge', 'meins', 'erfmg', 'erfme', 'dmbtr', 'waers', 'ebeln', 'ebelp', 'aufnr', 'kostl',
             'rsnum', 'rspos', 'vbeln_im', 'vbelp_im', 'sjahr', 'smbln', 'smblp', 'budat')], None),
    'VBAKUK': ('vbak', 'Sales document header with status (compatibility view)', [(c, c, c == 'vbeln') for c in ('vbeln', 'vbtyp', 'auart', 'vkorg', 'kunnr', 'gbstk', 'lfstk', 'fkstk', 'abstk', 'cmgst', 'bestk')], None),
    'VBAPUK': ('vbap', 'Sales document item with status (compatibility view)', [(c, c, c in ('vbeln', 'posnr')) for c in ('vbeln', 'posnr', 'matnr', 'gbsta', 'lfsta', 'fksaa', 'absta')], None),
}
AREA_OF = [
    ('sales', 'Sales and billing', 'Sales orders, deliveries, billing documents, pricing and document flow',
     ['I_SalesDocument', 'I_SalesDocumentItem', 'I_SalesOrder', 'I_SalesOrderItem', 'I_SalesOrderScheduleLine', 'I_SalesOrderPartner', 'I_SalesOrderItemPricingElement',
      'I_DeliveryDocument', 'I_DeliveryDocumentItem', 'I_BillingDocument', 'I_BillingDocumentItem', 'I_BillingDocumentItemPrcgElmnt', 'I_SDDocumentProcessFlow',
      'I_SDDocumentMultiLevelProcFlow']),
    ('procurement', 'Procurement', 'Purchase requisitions and orders, PO history, supplier invoices, info records and source lists',
     ['I_PurchaseRequisitionItem', 'I_PurchaseRequisitionItemAPI01', 'I_PurchaseOrderAPI01', 'I_PurchaseOrderItemAPI01', 'I_PurchaseOrderScheduleLineAPI01',
      'I_PurOrdScheduleLineAPI01', 'I_PurOrdAccountAssignmentAPI01', 'I_PurchaseOrderHistoryAPI01', 'I_SupplierInvoiceAPI01', 'I_SuplrInvcItemPurOrdRefAPI01',
      'I_PurchasingInfoRecordApi01', 'I_PurgInfoRecdOrgPlantDataApi01', 'I_PurchasingSourceList']),
    ('inventory', 'Inventory', 'Material documents, stock, batches and reservations',
     ['I_MaterialDocumentHeader_2', 'I_MaterialDocumentItem_2', 'I_MaterialStock_2', 'I_StockQuantityCurrentValue_2', 'I_Batch', 'I_Reservation', 'I_ReservationDocumentItem',
      'I_Material', 'I_ProductPlant']),
    ('accounting', 'Accounting', 'Journal entries, line items, balances, ledgers, segments and fixed assets',
     ['I_JournalEntry', 'I_JournalEntryItem', 'I_GLAccountLineItem', 'I_OperationalAcctgDocItem', 'I_GLAcctBalanceCube', 'I_Ledger', 'I_Segment', 'I_GLAccountTextRawData',
      'I_FiscalYearPeriodForVariant', 'I_InternalOrder', 'I_AssetClass', 'I_FixedAsset', 'I_FixedAssetAssgmt']),
    ('production', 'Production', 'Planned and manufacturing orders, operations, confirmations, BOMs, work centers, production versions',
     ['I_PlannedOrder', 'I_ManufacturingOrder', 'I_ManufacturingOrderItem', 'I_ManufacturingOrderOperation', 'I_MfgOrderConfirmation', 'I_ProductionVersion',
      'I_MaterialBOMLink', 'I_BillOfMaterial', 'I_BillOfMaterialItemBasic', 'I_WorkCenter']),
    ('maintenance', 'Maintenance and quality', 'Equipment, functional locations, notifications, maintenance orders and plans, inspection lots',
     ['I_Equipment', 'I_FunctionalLocation', 'I_MaintenanceNotification', 'I_MaintenanceOrder', 'I_MaintenancePlan', 'I_MaintenanceItem', 'I_InspectionLot',
      'I_InspectionCharacteristic', 'I_InspectionResult', 'I_InspLotUsageDecision']),
    ('projects', 'Projects and cross-application', 'Projects, WBS elements, change documents, users and business partner details',
     ['I_Project', 'I_EnterpriseProject', 'I_WBSElement', 'I_WBSElementBasicData', 'I_ChangeDocument', 'I_ChangeDocumentItem', 'I_User', 'I_BusinessUser',
      'I_BusinessPartnerAddress', 'I_BusinessPartnerAddressUsage', 'I_BusinessPartnerBank']),
]

# the second set of documents (S/4HANA 2025 module and CDS dictionaries): transactional_2025.py
import transactional_2025 as T25
SKIP |= T25.SKIP
KEYS.update(T25.KEYS)
for _t, _fs in T25.EXTRA.items(): EXTRA[_t] = EXTRA.get(_t, []) + [x for x in _fs if x not in EXTRA.get(_t, [])]
VIEWS_SPEC.update(T25.VIEWS)
AGG.update(T25.AGG)
COMPAT.update(T25.COMPAT)
for _a in AREA_OF: _a[3].extend(v for v in T25.AREAS.get(_a[0], []) if v not in _a[3])
AREA_OF.append(('logistics', 'Warehouse and transportation', 'EWM storage bins and warehouse tasks, TM freight orders', T25.AREAS['logistics']))

# ------------------------------------------------------------------ build the tables and views
def definitions():
    d = json.load(open(os.path.join(HERE, 'dictionaries.json')))
    defs = {}
    for name, t in d['tables'].items():
        if name in SKIP: continue
        defs[name] = {'description': DESC.get(name, t['description']), 'keys': list(t['keys']), 'fields': list(t['fields'])}
    for name in NEW_TABLES: defs.setdefault(name, {'description': DESC.get(name, name), 'keys': [], 'fields': []})
    for name, ks in KEYS.items():
        if name in defs: defs[name]['keys'] = list(ks)
    for name, fs in EXTRA.items():
        if name in defs: defs[name]['fields'] += [f for f in fs if f not in defs[name]['fields']]
    for name, fs in T25.DROP_FIELDS.items():
        if name in defs: defs[name]['fields'] = [x for x in defs[name]['fields'] if x not in fs]
    for t in defs.values():
        t['fields'] = t['keys'] + [f for f in t['fields'] if f not in t['keys'] and f not in ('MANDT', 'CLIENT', 'RCLNT') and re.match(r'^[A-Z][A-Z0-9_]*$', f)]
    return defs

def extend(TABLES, VIEWS, D, table, view, k, f, AREAS):
    defs = definitions()
    for name, t in defs.items():
        tn = name.lower()
        fields = t['fields']
        if tn in TABLES:   # a table of the master data layer: the documents' further fields join it
            label, have = TABLES[tn]
            names = {x[0] for x in have}
            for n in fields:
                if n.lower() in names or n in t['keys']: continue
                ty, ref = typ(name, n, fields)
                have.append((n.lower(), ty, False, f'{tn}.{ref.lower()}' if ref else None))
            continue
        cols = []
        for n in fields:
            ty, ref = typ(name, n, fields)
            if n in t['keys'] and ty.startswith(('abap.curr', 'abap.quan', 'abap.dec')): ty = 'abap.char(20)'
            cols.append((n.lower(), ty, n in t['keys'], f'{tn}.{ref.lower()}' if ref else None))
        if not any(c[2] for c in cols): cols[0] = (cols[0][0], cols[0][1], True, cols[0][3])
        TABLES[tn] = (t['description'] or name, [('mandt', 'abap.clnt', True, None)] + sorted(cols, key=lambda c: not c[2]))
    for tn, (label, cols) in T25.NAMESPACED.items():
        TABLES[tn] = (label, [('mandt', 'abap.clnt', True, None)] + [(n, ty, key, None) for n, ty, key in cols])
    # the processes below use further fields of SAP's tables than the documents list: a first run finds them, they are
    # added to the tables, the second run makes the data
    probe = Data(TABLES, D, probe=True)
    probe.build()
    for tn, names in probe.dropped.items():
        label, cols = TABLES[tn]
        have = {c[0].upper() for c in cols}
        for n in sorted(names):
            ty, ref = typ(tn.upper(), n.upper(), have | {x.upper() for x in names})
            if ref and ref.lower() not in {c[0] for c in cols} and ref.lower() not in names: ty, ref = ty.replace('curr', 'dec').replace('quan', 'dec'), None
            cols.append((n, ty, False, f'{tn}.{ref.lower()}' if ref else None))
    have_views = {v[0] for v in VIEWS}
    for vname, (src, label, keymap, where, over) in VIEWS_SPEC.items():
        if vname in have_views or keymap is None or src not in TABLES: continue
        fields = [c[0].upper() for c in TABLES[src][1] if c[0] != 'mandt']
        cols, used = [], set()
        for key, alias in keymap.items():
            cols.append(k(key.lower(), alias)); used.add(alias)
        for n in fields:
            if n in keymap: continue
            alias = over.get(n) or CDS.get(n)
            if not alias or alias in used: continue
            cols.append(f(n.lower(), alias)); used.add(alias)
        view(vname, label, src, cols, (), where)
    for vname, (src, label, cols, group) in AGG.items():
        if vname not in have_views: view(vname, label, src, [(e, a, key) for e, a, key in cols], (), group)
    for vname, (src, label, cols, where) in COMPAT.items():
        have = {c[0] for c in TABLES[src][1]}
        view(vname, label, src, [(e, a, key) for e, a, key in cols if e in have or not re.match(r'^\w+$', e)], (), where)
    aliases(VIEWS, TABLES)
    listed = {v for *_, vs in AREAS for v in vs}
    for area in AREA_OF:
        vs = [v for v in area[3] if v in {x[0] for x in VIEWS} and v not in listed]
        if vs: AREAS.append((*area[:3], vs))
    AREAS.append(('compat', 'Compatibility views', 'Old tables read from the S/4HANA ones (MKPF, MSEG, VBUK, VBUP, BSID/BSIK/BSIS, GLPCA, COSP/COSS, ANEP)', [v for v in COMPAT]))
    rnd.seed(4711)
    Data(TABLES, D).build()

def aliases(VIEWS, TABLES):
    """The element names the documents give for a view, where the view has the field under another name or not at all:
    a further element on the same field (I_SalesOrder: OrganizationDivision next to Division)."""
    docs = json.load(open(os.path.join(HERE, 'dictionaries.json')))['views']
    rev = {}
    for n, a in CDS.items(): rev.setdefault(a, n)
    for name, label, src, cols, assocs, where, text in VIEWS:
        elems = docs.get(name, {}).get('elements') or []
        if not elems or src not in TABLES or (where and 'group by' in where) or any(not re.match(r'^\w+$', e) for e, *_ in cols): continue
        have = {c[0] for c in TABLES[src][1]}
        used = {a for _, a, _ in cols}
        for el in elems:
            field = (T25.SYNONYMS.get(el) or rev.get(el) or '').lower()
            if el in used or not field or not all(x in have for x in re.findall(r'[a-z_][a-z0-9_]*', field)): continue
            cols.append((field, el, False)); used.add(el)

# ------------------------------------------------------------------ demo data
def ymd(x): return x.strftime('%Y%m%d')
def day(m, d_, y=2026): return dt.date(y, m, d_)
def plus(s, n): return ymd(dt.datetime.strptime(s, '%Y%m%d').date() + dt.timedelta(days=n))

class Data:
    """Documents of a demo client: they reference the master data and each other like in a real system."""
    def __init__(self, TABLES, D, probe=False):
        self.T, self.D, self.probe, self.dropped = TABLES, D, probe, {}
        self.cols = {t: [c for c in v[1] if c[0] != 'mandt'] for t, v in TABLES.items()}
        self.co = {r['bukrs']: r for r in D['t001']}
        self.plants = {r['werks']: r for r in D['t001w']}
        self.slocs = {}
        for r in D['t001l']: self.slocs.setdefault(r['werks'], []).append(r['lgort'])
        self.cust = {}
        for r in D['knb1']: self.cust.setdefault(r['bukrs'], []).append(r['kunnr'])
        self.supp = {}
        for r in D['lfb1']: self.supp.setdefault(r['bukrs'], []).append(r['lifnr'])
        self.kna1 = {r['kunnr']: r for r in D['kna1']}
        self.lfa1 = {r['lifnr']: r for r in D['lfa1']}
        self.text = {r['matnr']: r['maktx'] for r in D['makt'] if r['spras'] == 'E'}
        self.mara = {r['matnr']: r for r in D['mara']}
        self.price = {(r['matnr'], r['bwkey']): float(r['verpr'] or r['stprs'] or 0) for r in D['mbew']}
        self.marc = {(r['matnr'], r['werks']): r for r in D['marc']}
        self.knb1 = {(r['kunnr'], r['bukrs']): r for r in D['knb1']}
        self.cc = {}
        for r in D['csks']: self.cc.setdefault(r['bukrs'], []).append(r['kostl'])
        self.users = ['CB9980000010', 'CB9980000020', 'ANNA.BECKER', 'JOHN.MILLER', 'PRIYA.SHARMA', 'MARCO.ROSSI']
        self.n = {}
        self.out = {}
        self.region = {'1010': ('D', 19.0, 'A1', 'V1'), '1710': ('E', 7.25, 'A1', 'V1'), '4110': ('E', 18.0, 'A1', 'V1')}

    def num(self, kind, start, width=10):
        self.n[kind] = self.n.get(kind, start - 1) + 1
        return str(self.n[kind]).zfill(width)
    def default(self, ty):
        if ty.startswith(('abap.curr', 'abap.quan', 'abap.dec', 'abap.int', 'abap.fltp')): return 0
        return ''
    def add(self, t, **row):
        t = t.lower()
        if t not in self.cols: return row
        r = {c[0]: self.default(c[1]) for c in self.cols[t]}
        for key, v in row.items():
            key = key.lower()
            if key not in r:
                if key != 'base': self.dropped.setdefault(t, set()).add(key)
                if self.probe: r[key] = v   # later steps of the first run read it back
                continue
            ty = next(c[1] for c in self.cols[t] if c[0] == key)
            m = re.match(r'abap\.(char|numc)\((\d+)\)', ty)
            if m and v is not None and not isinstance(v, (int, float)):
                v = str(v)
                if m.group(1) == 'numc' and v.isdigit(): v = v.zfill(int(m.group(2)))[-int(m.group(2)):]
                else: v = v[:int(m.group(2))]
            elif m and isinstance(v, (int, float)): v = str(int(v)).zfill(int(m.group(2))) if m.group(1) == 'numc' else str(v)
            if ty.startswith(('abap.curr', 'abap.dec', 'abap.quan')) and isinstance(v, float): v = round(v, 3 if 'quan' in ty or ',3' in ty else 2)
            r[key] = '' if v is None else v
        self.out.setdefault(t, []).append(r)
        return r
    def has(self, t): return t.lower() in self.cols

    # -------------------------------------------------------------- the processes
    def build(self):
        self.config()
        self.partners()
        self.sales()
        self.procurement()
        self.production()
        self.inventory()
        self.maintenance_quality()
        self.assets_projects_co()
        self.cross_app()
        self.additions_2025()
        self.fill_rest()
        if self.probe: return
        for t, rows in self.out.items():
            self.D.setdefault(t, []).extend(rows)
        self.stock_from_movements()

    def stock_from_movements(self):
        """MARD (stock per storage location) and MBEW (stock and value per valuation area) as the material documents leave them."""
        qty = {}
        for r in self.out.get('matdoc', []):
            k_ = (r['matnr'], r['werks'], r['lgort'])
            qty[k_] = qty.get(k_, 0) + float(r['stock_qty'])
        mard = {(r['matnr'], r['werks'], r['lgort']): r for r in self.D['mard']}
        for k_, q in qty.items():
            if k_ in mard: mard[k_]['labst'] = round(q, 3)
            else: self.D['mard'].append({**{c[0]: self.default(c[1]) for c in self.cols['mard']}, 'matnr': k_[0], 'werks': k_[1], 'lgort': k_[2], 'labst': round(q, 3)})
        total = {}
        for (m, w, l), q in qty.items():
            b = next(x['bwkey'] for x in self.D['t001w'] if x['werks'] == w)
            total[(m, b)] = total.get((m, b), 0) + q
        for r in self.D['mbew']:
            q = total.get((r['matnr'], r['bwkey']))
            if q is not None:
                r['lbkum'] = round(q, 3)
                r['salk3'] = round(q * float(r['verpr'] or r['stprs'] or 0) / float(r.get('peinh') or 1), 2)

    def config(self):
        for b, (vbtyp, txt) in {'OR': ('C', 'Standard Order'), 'RE': ('H', 'Returns'), 'QT': ('B', 'Quotation'), 'CR': ('K', 'Credit Memo Request'), 'CS': ('C', 'Cash Sale')}.items():
            self.add('tvak', auart=b, vbtyp=vbtyp, bezei=txt, kalvg='1', numki='01')
        for p, txt in {'TAN': 'Standard Item', 'TAD': 'Service', 'REN': 'Returns', 'AGN': 'Quotation Item'}.items(): self.add('tvap', pstyv=p, fkrel='J' if p != 'AGN' else '', prsfd='X', vtext=txt)
        for b in self.co:
            self.add('tvbur', vkbur=b, bezei=f'Sales office {self.co[b]["ort01"]}')
            self.add('tvst', vstel=b, vtext=f'Shipping point {b}', werks=b)
            for v in ('10', '20'): self.add('tvkov', vkorg=b, vtweg=v)
            self.add('t024w', werks=b, ekorg=b)
            self.add('t093c', bukrs=b, afapl='YDE' if b == '1010' else 'YUS' if b == '1710' else 'YIN')
            self.add('finsc_ld_cmp', rldnr='0L', bukrs=b, curtph='10', curtpk='30', periv='K4' if b != '4110' else 'V3')
            self.add('finsc_ld_cmp', rldnr='2L', bukrs=b, curtph='10', curtpk='30', periv='K4' if b != '4110' else 'V3')
            for kind in ('+', 'D', 'K', 'S', 'A', 'M'):
                self.add('t001b', bukrs=b, mkoar=kind, bkont='', vkont='ZZZZZZZZZZ', frye1='2026', frpe1='001', toye1='2026', tope1='012')
            for h, (bank, acct) in {'DEUT1': ('10070000', '1234567'), 'CITI1': ('021000089', '9876543'), 'HDFC1': ('HDFC0000001', '50100012345678')}.items():
                if (b == '1010') == (h == 'DEUT1') or (b == '1710') == (h == 'CITI1') or (b == '4110') == (h == 'HDFC1'):
                    if (b, h) in (('1010', 'DEUT1'), ('1710', 'CITI1'), ('4110', 'HDFC1')):
                        self.add('t012', bukrs=b, hbkid=h, banks=self.co[b]['land1'], bankl=bank)
                        self.add('t012k', bukrs=b, hbkid=h, hktid='CHK01', bankn=acct, waers=self.co[b]['waers'], hkont='0010010000')
                        self.add('fclm_bam_aclink2', acc_id=f'BAM{b}', bukrs=b, hbkid=h, hktid='CHK01', bankn=acct, waers=self.co[b]['waers'])
        for v in ('10', '20'): pass
        for g, txt in {'001': 'Retail', '002': 'Wholesale'}.items(): self.add('tvkgr', vkgrp=g, bezei=txt)
        self.add('finsc_ledger', rldnr='0L', xleading='X', name='Leading Ledger')
        self.add('finsc_ledger', rldnr='2L', xleading='', name='IFRS Ledger')
        for b, (txt, koart) in {'SA': ('G/L account document', 'S'), 'RV': ('Billing document transfer', 'D'), 'DZ': ('Customer payment', 'D'), 'DR': ('Customer invoice', 'D'),
                                'KZ': ('Vendor payment', 'K'), 'KR': ('Vendor invoice', 'K'), 'RE': ('Invoice - gross', 'K'), 'WE': ('Goods receipt', 'S'),
                                'WA': ('Goods issue', 'S'), 'WL': ('Goods issue/delivery', 'S'), 'AA': ('Asset posting', 'A'), 'AF': ('Depreciation postings', 'A'), 'AB': ('Accounting document', 'S')}.items():
            self.add('t003', blart=b, ltext=txt, koars=koart, numkr='01')
        for k_, (txt, side, koart) in {'01': ('Invoice', 'S', 'D'), '11': ('Credit memo', 'H', 'D'), '15': ('Incoming payment', 'H', 'D'), '21': ('Credit memo', 'S', 'K'),
                                      '25': ('Outgoing payment', 'S', 'K'), '31': ('Invoice', 'H', 'K'), '40': ('Debit entry', 'S', 'S'), '50': ('Credit entry', 'H', 'S'),
                                      '70': ('Debit asset', 'S', 'A'), '75': ('Credit asset', 'H', 'A'), '86': ('GR/IR debit', 'S', 'S'), '96': ('GR/IR credit', 'H', 'S'),
                                      '89': ('Stock inward movement', 'S', 'M'), '99': ('Stock outward movement', 'H', 'M')}.items():
            self.add('tbsl', bschl=k_, shkzg=side, koart=koart, ltext=txt)
        for w, (txt, side, kzbew) in {'101': ('GR goods receipt', 'S', 'B'), '102': ('GR for PO reversal', 'H', 'B'), '201': ('GI for cost center', 'H', ''), '261': ('GI for order', 'H', ''),
                                     '311': ('TF trfr within plant', 'H', ''), '551': ('GI scrapping', 'H', ''), '561': ('Initial entry of stock', 'S', ''), '601': ('GD goods issue: delvy', 'H', ''),
                                     '701': ('GR phys. inv: whse', 'S', ''), '702': ('GI phys. inv: whse', 'H', ''), '101F': ('', '', '')}.items():
            if not txt: continue
            self.add('t156', bwart=w, shkzg=side, kzbew=kzbew, xstbw='')
            self.add('t156t', spras='E', bwart=w, btext=txt)
        for b, txt in {('F', 'NB'): 'Standard PO', ('F', 'FO'): 'Framework order', ('B', 'NB'): 'Purchase requisition', ('K', 'MK'): 'Quantity contract', ('L', 'LP'): 'Scheduling agreement'}.items():
            self.add('t161', bstyp=b[0], bsart=b[1], batxt=txt, numki='45')
        for b, txt in {'PR00': ('Price', 'C', 'B'), 'K004': ('Material discount', 'C', 'A'), 'K007': ('Customer discount', 'A', 'A'), 'MWST': ('Output tax', 'A', 'D'), 'PB00': ('Gross price', 'C', 'B'), 'NAVS': ('Non-deductible input tax', 'A', 'D')}.items():
            self.add('t685', kvewe='A', kappl='V' if b[0] not in ('P', 'N') else 'M', kschl=b, vtext=txt[0])
            self.add('t685a', kappl='V' if b[0] not in ('P', 'N') else 'M', kschl=b, krech=txt[1], koaid=txt[2], kznep='')
        for i, (step, kschl, txt) in enumerate([(10, 'PR00', 'Price'), (20, 'K004', 'Material discount'), (30, 'K007', 'Customer discount'), (100, 'MWST', 'Output tax')]):
            self.add('t683s', kvewe='A', kappl='V', kalsm='RVAA01', stunr=step, zaehk=1, kschl=kschl, vtext=txt)
        for y in (2025, 2026, 2027):
            for m in range(1, 13):
                last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).day
                self.add('t009b', periv='K4', bdatj=y, bumon=m, butag=last, poper=m, reljr='0')
                self.add('t009b', periv='V3', bdatj=y, bumon=m, butag=last, poper=(m + 8) % 12 + 1, reljr='-1' if m < 4 else '0')
        for s, txt in {'I0001': 'CRTD', 'I0002': 'REL', 'I0009': 'CNF', 'I0010': 'PCNF', 'I0012': 'DLV', 'I0045': 'TECO', 'I0046': 'CLSD', 'I0068': 'OSNO', 'I0070': 'OSTS', 'I0072': 'NOCO'}.items():
            self.add('tj02t', istat=s, spras='E', txt04=txt, txt30={'CRTD': 'Created', 'REL': 'Released', 'CNF': 'Confirmed', 'PCNF': 'Partially confirmed', 'DLV': 'Delivered',
                                                                  'TECO': 'Technically completed', 'CLSD': 'Closed', 'OSNO': 'Outstanding notification', 'OSTS': 'Outstanding task', 'NOCO': 'Notification completed'}[txt])
        for s, txt in {'E0001': 'INIT', 'E0002': 'APPR', 'E0003': 'REJ'}.items(): self.add('tj30t', stsma='ZSTATUS', estat=s, spras='E', txt04=txt, txt30={'INIT': 'Initial', 'APPR': 'Approved', 'REJ': 'Rejected'}[txt])
        for c, txt in {'DE': 'Germany calendar', 'US': 'USA calendar', 'IN': 'India calendar'}.items(): self.add('tfacd', ident=c[:2], ltext=txt, vjahr='2000', bjahr='2099')
        for seg, txt in {'1000_A': 'Products', '1000_B': 'Services', '1000_C': 'Trading'}.items(): self.add('fagl_segm', segment=seg, name=txt)
        for i, (node, txt) in enumerate([('YCOA_BS', 'Balance sheet'), ('ASSETS', 'Assets'), ('LIABS', 'Liabilities'), ('YCOA_PL', 'Profit and loss'), ('REVENUE', 'Revenue'), ('EXPENSES', 'Expenses')]):
            self.add('fagl_011pc', versn='YCOA', ergsl=node, txt45=txt)
        for acct, node in {'0010010000': 'ASSETS', '0012100000': 'ASSETS', '0013100000': 'ASSETS', '0021100000': 'LIABS', '0041000000': 'REVENUE', '0050000100': 'EXPENSES'}.items():
            self.add('fagl_011zc', versn='YCOA', ergsl=node, vonkt=acct, biskt=acct)
        for ktosl, (bklas, acct) in {'BSX': ('3100', '0013100000'), 'WRX': ('3100', '0021500000'), 'GBB': ('3100', '0050000100'), 'PRD': ('3100', '0050000100')}.items():
            self.add('t030', ktopl='YCOA', ktosl=ktosl, bwmod='0001', komok='VBR' if ktosl == 'GBB' else '', bklas=bklas, konts=acct, konth=acct)
        for afapl, txt in {'YDE': 'Germany', 'YUS': 'USA', 'YIN': 'India'}.items():
            for ab, t in {'01': 'Book depreciation', '15': 'Tax depreciation'}.items(): self.add('t093', afapl=afapl, afaber=ab, afbez=t)

    def partners(self):
        for kunnr, r in self.kna1.items():
            g = f'{int(kunnr):032X}'
            self.add('cvi_cust_link', partner_guid=g, customer=kunnr)
            self.add('but021_fs', partner=kunnr, adr_kind='XXDEFAULT', valid_to='99991231', addrnumber=r.get('adrnr', ''), valid_from='20200101')
            self.add('but0id', partner=kunnr, type='HCM001', idnumber=f'ID-{kunnr[-6:]}', institute='Registry', valid_date_from='20200101')
            self.add('dfkkbptaxnum', partner=kunnr, taxtype=f'{r["land1"]}0', taxnum=r.get('stceg') or f'{r["land1"]}{kunnr[-8:]}')
            self.add('knvi', kunnr=kunnr, aland=r['land1'], tatyp='MWST', taxkd='1')
            self.add('ukmbp_cms', partner=kunnr, risk_class='B', check_rule='01', credit_group='Z001')
            self.add('ukmbp_cms_sgm', partner=kunnr, credit_sgmnt=r.get('land1', '') and '1000', credit_limit=50000.0, xblocked='')
            for i, (h, pv) in enumerate([('AG', 'Sold-to'), ('WE', 'Ship-to'), ('RE', 'Bill-to'), ('RG', 'Payer')]):
                for b, ks in self.cust.items():
                    if kunnr in ks: self.add('knvp', kunnr=kunnr, vkorg=b, vtweg='10', spart='00', parvw=h, parza=0, kunn2=kunnr)
            parnr = self.num('parnr', 1, 10)
            self.add('knvk', parnr=parnr, kunnr=kunnr, namev=rnd.choice(['Anna', 'Ben', 'Clara', 'David', 'Eva', 'Farid']), name1=rnd.choice(['Klein', 'Smith', 'Rao', 'Lopez', 'Weber']), abtnr='0001', pafkt='01')
            self.add('knbk', kunnr=kunnr, banks=r['land1'], bankl='10070000', bankn=f'{rnd.randint(10**8, 10**9)}', bkont='01')
        for lifnr, r in self.lfa1.items():
            self.add('cvi_vend_link', partner_guid=f'{int(lifnr) + 7:032X}', vendor=lifnr)
            self.add('but021_fs', partner=lifnr, adr_kind='XXDEFAULT', valid_to='99991231', addrnumber=r.get('adrnr', ''), valid_from='20200101')
            self.add('lfbk', lifnr=lifnr, banks=r['land1'], bankl='10020030', bankn=f'{rnd.randint(10**8, 10**9)}', bkont='01')
            for b, ls in self.supp.items():
                if lifnr in ls and b == '4110': self.add('lfbw', lifnr=lifnr, bukrs=b, witht='J1', wt_withcd='94', wt_subjct='X')
        for p in self.D['but000']:
            self.add('but0bk', partner=p['partner'], bkvid='0001', banks='DE', bankl='10070000', bankn=f'{rnd.randint(10**8, 10**9)}', iban=f'DE89{rnd.randint(10**17, 10**18)}')
            a = self.num('addr', 9000001, 10)
            self.add('adr2', addrnumber=p.get('partner', ''), persnumber='', date_from='20200101', consnumber=1, tel_number=f'+49 30 {rnd.randint(1000000, 9999999)}', flgdefault='X')
            self.add('adr6', addrnumber=p.get('partner', ''), persnumber='', date_from='20200101', consnumber=1, smtp_addr=f'info{p["partner"][-4:]}@example.com', flgdefault='X')
        bps = [p['partner'] for p in self.D['but000']]
        for i in range(0, min(len(bps) - 1, 6), 2):
            self.add('but050', relnr=self.num('relnr', 1, 12), partner1=bps[i], partner2=bps[i + 1], date_to='99991231', date_from='20240101', reltyp='BUR001')
        for m in self.mara:
            for land in ('DE', 'US', 'IN'): self.add('mlan', matnr=m, aland=land, taxm1='1')
            self.add('mean', matnr=m, meinh=self.mara[m]['meins'], lfnum=1, ean11=self.mara[m].get('ean11') or f'4006381{rnd.randint(100000, 999999)}', eantp='HE', hpean='X')
            if self.mara[m]['mtart'] in ('HAWA', 'ROH', 'FERT'):
                self.add('mlgn', matnr=m, lgnum='101', ltkza='001', ltkze='001', lhmg1=100.0)
                self.add('mlgt', matnr=m, lgnum='101', lgtyp='001', lgpla=f'01-{rnd.randint(1, 20):02d}-{rnd.randint(1, 5):02d}', lpmax=200.0, lpmin=10.0)

    def gl(self, b, side, acct, amount, **more):
        return dict(drcrk=side, racct=acct, hsl=amount if side == 'S' else -amount, tsl=amount if side == 'S' else -amount, ksl=round((amount if side == 'S' else -amount) / self.fx(b), 2), **more)
    def fx(self, b): return {'1010': 0.926, '1710': 1.0, '4110': 83.4}[b]   # company code currency per USD (global currency)

    def journal(self, b, belnr, blart, budat, lines, awtyp='BKPF', awref='', xblnr='', bktxt='', tcode='FB01', user=None):
        """a journal entry: header (BKPF), line items (ACDOCA, ledgers 0L and 2L; BSEG; BSET for tax)."""
        cur = self.co[b]['waers']
        gj = budat[:4]
        user = user or rnd.choice(self.users)
        self.add('bkpf', bukrs=b, belnr=belnr, gjahr=gj, blart=blart, bldat=budat, budat=budat, monat=budat[4:6], cpudt=budat, cputm='101500', usnam=user, tcode=tcode,
                 xblnr=xblnr, bktxt=bktxt, waers=cur, hwaer=cur, kursf=1.0, awtyp=awtyp, awkey=f'{awref}{gj}' if awref else '', bstat='', glvor='RFBU')
        for rl in ('0L', '2L'):
            for i, ln in enumerate(lines, 1):
                ln = dict(ln)
                self.add('acdoca', rldnr=rl, rbukrs=b, gjahr=gj, belnr=belnr, docln=i, buzei=i, ktopl='YCOA', budat=budat, bldat=budat, blart=blart, poper=budat[4:6],
                         fiscyearper=f'{gj}0{budat[4:6]}', rwcur=cur, rtcur=cur, rhcur=cur, rkcur='USD', awtyp=awtyp, awref=awref, aworg=gj, usnam=user, **ln)
        for i, ln in enumerate(lines, 1):
            koart = ln.get('koart', 'S')
            amount = abs(ln['hsl'])
            bschl = {('D', 'S'): '01', ('D', 'H'): '15' if blart == 'DZ' else '11', ('K', 'H'): '31', ('K', 'S'): '25', ('S', 'S'): '40', ('S', 'H'): '50', ('M', 'S'): '89', ('M', 'H'): '99', ('A', 'S'): '70', ('A', 'H'): '75'}[(koart, ln['drcrk'])]
            self.add('bseg', bukrs=b, belnr=belnr, gjahr=gj, buzei=i, bschl=bschl, koart=koart, shkzg=ln['drcrk'], dmbtr=amount, wrbtr=amount, hkont=ln['racct'],
                     kunnr=ln.get('kunnr', ''), lifnr=ln.get('lifnr', ''), kostl=ln.get('rcntr', ''), prctr=ln.get('prctr', ''), matnr=ln.get('matnr', ''), werks=ln.get('werks', ''),
                     menge=ln.get('msl', 0), meins=ln.get('runit', ''), mwskz=ln.get('mwskz', ''), zterm=ln.get('zterm', ''), zfbdt=budat if koart in 'DK' else '',
                     augbl=ln.get('augbl', ''), augdt=ln.get('augdt', ''), sgtxt=ln.get('sgtxt', ''), zuonr=ln.get('zuonr', ''), ebeln=ln.get('ebeln', ''), ebelp=ln.get('ebelp', ''),
                     vbeln=ln.get('vbeln', ''), segment=ln.get('segment', ''), h_budat=budat, h_bldat=budat, h_waers=cur, h_blart=blart)
            if ln.get('ktosl') in ('MWS', 'VST'):
                self.add('bset', bukrs=b, belnr=belnr, gjahr=gj, buzei=i, mwskz=ln.get('mwskz', ''), ktosl=ln['ktosl'], hwbas=ln.get('base', 0.0), fwbas=ln.get('base', 0.0),
                         hwste=amount, fwste=amount, shkzg=ln['drcrk'], hkont=ln['racct'], kschl='MWST' if ln['ktosl'] == 'MWS' else 'VST')

    def clear(self, b, belnr, gj, line, augbl, augdt):
        for r in self.out.get('acdoca', []):
            if r['rbukrs'] == b and r['belnr'] == belnr and r['gjahr'] == gj and int(r['docln']) == line: r['augbl'], r['augdt'] = augbl, augdt
        for r in self.out.get('bseg', []):
            if r['bukrs'] == b and r['belnr'] == belnr and r['gjahr'] == gj and int(r['buzei']) == line: r['augbl'], r['augdt'] = augbl, augdt

    def flow(self, v, pv, tv, n, pn, tn, qty, unit, value, cur, date):
        self.add('vbfa', ruuid=f'{rnd.getrandbits(128):032X}', vbelv=v, posnv=pv, vbtyp_v=tv, vbeln=n, posnn=pn, vbtyp_n=tn, rfmng=qty, meins=unit, rfwrt=value, waers=cur,
                 erdat=date, erzet='120000', plmin='+')

    def sales(self):
        goods = ['TG11', 'TG12', 'TG13', 'TG14', 'TG15', 'TG16', 'TG17', 'TG18', 'FG126']
        orders = []
        for b in self.co:
            cur, (lang, taxrate, _, _) = self.co[b]['waers'], self.region[b]
            for o in range(4):
                vbeln = self.num('so', 1001)
                kunnr = self.cust[b][o % len(self.cust[b])]
                audat = ymd(day(1 + o * 2 + list(self.co).index(b), 5 + o * 3))
                knumv = self.num('knumv', 1)
                items, net = [], 0.0
                for i, m in enumerate(rnd.sample(goods, rnd.randint(1, 3)), 1):
                    qty = rnd.randint(2, 20)
                    price = round(self.price.get((m, b), 100.0) * 1.35, 2)
                    items.append((i * 10, m, qty, price, round(qty * price, 2)))
                    net += qty * price
                net = round(net, 2)
                tax = round(net * taxrate / 100, 2)
                kb = self.knb1.get((kunnr, b), {})
                self.add('vbak', vbeln=vbeln, auart='OR', vbtyp='C', audat=audat, erdat=audat, erzet='093000', ernam=rnd.choice(self.users), vkorg=b, vtweg='10', spart='00',
                         vkbur=b, vkgrp='001', kunnr=kunnr, bstnk=f'PO-{kunnr[-4:]}-{o + 1:02d}', bstdk=audat, waerk=cur, netwr=net, knumv=knumv, vdatu=plus(audat, 10),
                         vsbed='01', gbstk='A', lfstk='A', fkstk='A', abstk='A', cmgst='A', bestk='C', autlf='')
                self.add('vbkd', vbeln=vbeln, posnr=0, zterm=kb.get('zterm', 'NT30'), inco1='EXW', inco2=self.co[b]['ort01'], bstkd=f'PO-{kunnr[-4:]}-{o + 1:02d}', kursk=1.0,
                         prsdt=audat, fkdat=plus(audat, 14), kdgrp='01', konda='01', pltyp='01')
                adr = self.kna1[kunnr].get('adrnr', '')
                for pv in ('AG', 'WE', 'RE', 'RG'): self.add('vbpa', vbeln=vbeln, posnr=0, parvw=pv, parza=0, kunnr=kunnr, adrnr=adr)
                for pos, m, qty, price, value in items:
                    marc = self.marc.get((m, b), {})
                    self.add('vbap', vbeln=vbeln, posnr=pos, matnr=m, arktx=self.text.get(m, m), pstyv='TAN', kwmeng=qty, vrkme='PC', meins='PC', klmeng=qty, umvkz=1, umvkn=1,
                             netpr=price, netwr=value, waerk=cur, werks=b, lgort=self.slocs[b][0], vstel=b, route='R00001', prctr=marc.get('prctr', ''), matkl=self.mara[m]['matkl'],
                             gbsta='A', lfsta='A', fksaa='A', absta='A', erdat=audat, ernam=rnd.choice(self.users), mwsbp=round(value * taxrate / 100, 2))
                    self.add('vbep', vbeln=vbeln, posnr=pos, etenr=1, edatu=plus(audat, 10), wmeng=qty, bmeng=qty, lmeng=qty, vrkme='PC', meins='PC', ettyp='CP', mbdat=plus(audat, 8),
                             lddat=plus(audat, 9), wadat=plus(audat, 9), tddat=plus(audat, 9))
                    self.add('prcd_elements', knumv=knumv, kposn=pos, stunr=10, zaehk=1, kschl='PR00', kbetr=price, kpein=1, kmein='PC', kwert=value, waers=cur, kawrt=qty,
                             kinak='', kstat='', koaid='B', kntyp='', kherk='A', knumh=f'{rnd.randint(10**9, 10**10 - 1)}')
                    self.add('prcd_elements', knumv=knumv, kposn=pos, stunr=100, zaehk=1, kschl='MWST', kbetr=taxrate, kpein=0, kmein='', kwert=round(value * taxrate / 100, 2),
                             waers=cur, kawrt=value, kinak='', kstat='', koaid='D', kntyp='', kherk='A')
                orders.append((b, vbeln, kunnr, audat, items, net, tax, cur, knumv))
        # deliveries, goods issues, billing, journal entries, payments
        for n, (b, vbeln, kunnr, audat, items, net, tax, cur, knumv) in enumerate(orders):
            vbak = next(r for r in self.out['vbak'] if r['vbeln'] == vbeln)
            if n % 4 == 3: continue                                   # open orders
            dlv = self.num('dlv', 80000001)
            wadat = plus(audat, 9)
            gi_done = n % 4 != 2 or n < 8
            self.add('likp', vbeln=dlv, lfart='LF', vstel=b, vkorg=b, kunnr=kunnr, kunag=kunnr, lfdat=plus(audat, 10), wadat=wadat, wadat_ist=wadat if gi_done else '',
                     lddat=wadat, kodat=wadat, erdat=plus(audat, 7), erzet='080000', ernam=rnd.choice(self.users), btgew=round(sum(i[2] for i in items) * 1.8, 3),
                     ntgew=round(sum(i[2] for i in items) * 1.5, 3), gewei='KG', route='R00001', vsbed='01', inco1='EXW', wbstk='C' if gi_done else 'A', kostk='C',
                     gbstk='C' if gi_done else 'B', fkstk='A', anzpk=1)
            mblnr = self.num('matdoc', 4900000001) if gi_done else ''
            for k_, (pos, m, qty, price, value) in enumerate(items, 1):
                self.add('lips', vbeln=dlv, posnr=pos, matnr=m, arktx=self.text.get(m, m), pstyv='TAN', lfimg=qty, vrkme='PC', meins='PC', lgmng=qty, werks=b,
                         lgort=self.slocs[b][0], vgbel=vbeln, vgpos=pos, vgtyp='C', umvkz=1, umvkn=1, erdat=plus(audat, 7), prctr=self.marc.get((m, b), {}).get('prctr', ''),
                         wbsta='C' if gi_done else 'A', matkl=self.mara[m]['matkl'], charg='')
                self.flow(vbeln, pos, 'C', dlv, pos, 'J', qty, 'PC', value, cur, plus(audat, 7))
                if gi_done:
                    cost = round(self.price.get((m, b), 50) * qty, 2)
                    self.matdoc(mblnr, wadat[:4], k_, '601', m, b, self.slocs[b][0], -qty, cost, cur, wadat, vbeln_im=dlv, vbelp_im=pos, kunnr=kunnr, kdauf=vbeln, kdpos=pos,
                                bktxt=f'Delivery {dlv.lstrip("0")}', vgart='WL')
                    self.flow(dlv, pos, 'J', mblnr, k_, 'R', qty, 'PC', cost, cur, wadat)
            for r in self.out['vbap']:
                if r['vbeln'] == vbeln: r['lfsta'] = 'C'
            vbak.update(lfstk='C', gbstk='B')
            if gi_done:
                cogs = round(sum(self.price.get((m, b), 50) * q for _, m, q, _, _ in items), 2)
                fi = self.num(f'fi_wl_{b}', 4900000001)
                self.journal(b, fi, 'WL', wadat, [self.gl(b, 'S', '0050000100', cogs, koart='S', sgtxt='Cost of goods sold', prctr='YB102'),
                                                   self.gl(b, 'H', '0013100000', cogs, koart='M', sgtxt='Inventory', prctr='YB102')], awtyp='MKPF', awref=mblnr, tcode='VL02N')
            if n % 4 == 2 and n >= 8: continue                     # delivered, not billed yet
            if not gi_done: continue
            bill = self.num('bill', 90000001)
            fkdat = plus(wadat, 2)
            fi = self.num(f'fi_rv_{b}', 9400000001)
            self.add('vbrk', vbeln=bill, fkart='F2', vbtyp='M', fkdat=fkdat, erdat=fkdat, erzet='070000', ernam=rnd.choice(self.users), vkorg=b, vtweg='10', spart='00',
                     kunag=kunnr, kunrg=kunnr, netwr=net, mwsbk=tax, waerk=cur, bukrs=b, belnr=fi, gjahr=fkdat[:4], rfbsk='C', zterm=self.knb1.get((kunnr, b), {}).get('zterm', 'NT30'),
                     knumv=self.num('knumv', 1), land1=self.kna1[kunnr]['land1'], fksto='', inco1='EXW', xblnr=bill, kurrf=1.0, fkdat_rl=fkdat)
            for pos, m, qty, price, value in items:
                self.add('vbrp', vbeln=bill, posnr=pos, fkimg=qty, vrkme='PC', meins='PC', fklmg=qty, netwr=value, mwsbp=round(value * self.region[b][1] / 100, 2), matnr=m,
                         arktx=self.text.get(m, m), pstyv='TAN', aubel=vbeln, aupos=pos, vgbel=dlv, vgpos=pos, vgtyp='J', werks=b, prctr=self.marc.get((m, b), {}).get('prctr', ''),
                         matkl=self.mara[m]['matkl'], erdat=fkdat, kursk=1.0, wavwr=round(self.price.get((m, b), 50) * qty, 2))
                self.flow(dlv, pos, 'J', bill, pos, 'M', qty, 'PC', value, cur, fkdat)
                self.flow(vbeln, pos, 'C', bill, pos, 'M', qty, 'PC', value, cur, fkdat)
            for r in self.out['vbap']:
                if r['vbeln'] == vbeln: r.update(fksaa='C', gbsta='C')
            for r in self.out['likp']:
                if r['vbeln'] == dlv: r['fkstk'] = 'C'
            vbak.update(fkstk='C', gbstk='C')
            zterm = self.knb1.get((kunnr, b), {}).get('zterm', 'NT30')
            lines = [self.gl(b, 'S', '0012100000', round(net + tax, 2), koart='D', kunnr=kunnr, zterm=zterm, sgtxt=f'Invoice {bill.lstrip("0")}', zuonr=vbeln, vbeln=bill, segment='1000_C')]
            for pos, m, qty, price, value in items:
                lines.append(self.gl(b, 'H', '0041000000' if self.kna1[kunnr]['land1'] == self.co[b]['land1'] else '0041000100', value, koart='S', matnr=m, werks=b, msl=-qty,
                                     runit='PC', prctr=self.marc.get((m, b), {}).get('prctr', ''), vbeln=bill, posnr=pos, kunnr=kunnr, segment='1000_C', sgtxt='Revenue'))
            lines.append(self.gl(b, 'H', '0022000000', tax, koart='S', ktosl='MWS', mwskz=self.region[b][2], base=net, sgtxt='Output tax'))
            self.journal(b, fi, 'RV', fkdat, lines, awtyp='VBRK', awref=bill, xblnr=bill, bktxt=f'Billing {bill.lstrip("0")}', tcode='VF01')
            if n % 2 == 0:                                           # paid: incoming payment clears the receivable
                pay = self.num(f'fi_dz_{b}', 1400000001)
                pdate = plus(fkdat, 20)
                self.journal(b, pay, 'DZ', pdate, [self.gl(b, 'S', '0010010000', round(net + tax, 2), koart='S', sgtxt='Bank'),
                                                    self.gl(b, 'H', '0012100000', round(net + tax, 2), koart='D', kunnr=kunnr, augbl=pay, augdt=pdate, sgtxt='Payment')], tcode='F-28')
                self.clear(b, fi, fkdat[:4], 1, pay, pdate)
                self.clear(b, pay, pdate[:4], 2, pay, pdate)
                kukey = self.num('kukey', 1, 8)
                self.add('febko', kukey=kukey, bukrs=b, hbkid={'1010': 'DEUT1', '1710': 'CITI1', '4110': 'HDFC1'}[b], hktid='CHK01', azdat=pdate, aznum=self.num('aznum', 1, 5),
                         waers=cur, ssbtr=0.0, sumso=0.0, sumha=round(net + tax, 2), astat='8')
                self.add('febep', kukey=kukey, esnum=1, valut=pdate, budat=pdate, kwbtr=round(net + tax, 2), vgext='051', vgint='ZDZ1', belnr=pay, gjahr=pdate[:4], partn=self.kna1[kunnr]['name1'])
                self.add('febre', kukey=kukey, esnum=1, rsnum=1, vwezw=f'Invoice {bill.lstrip("0")} customer {kunnr.lstrip("0")}')
        # condition records: material prices per customer
        for b in self.co:
            for m in ['TG11', 'TG12', 'TG13']:
                knumh = self.num('knumh', 1)
                for kunnr in self.cust[b][:2]:
                    self.add('a305', kappl='V', kschl='PR00', vkorg=b, vtweg='10', kunnr=kunnr, matnr=m, datbi='99991231', datab='20260101', knumh=knumh)
                    self.add('a005', kappl='V', kschl='K007', vkorg=b, vtweg='10', kunnr=kunnr, matnr=m, datbi='99991231', datab='20260101', knumh=knumh)
                    break
                self.add('konh', knumh=knumh, kappl='V', kschl='PR00', datab='20260101', datbi='99991231', erdat='20251215', ernam='CB9980000010', kvewe='A', kotabnr='305')
                self.add('konp', knumh=knumh, kopos=1, kschl='PR00', kbetr=round(self.price.get((m, b), 100) * 1.3, 2), konwa=self.co[b]['waers'], kpein=1, kmein='PC', loevm_ko='')
                self.add('konm', knumh=knumh, kopos=1, klfn1=1, kstbm=10.0, kbetr=round(self.price.get((m, b), 100) * 1.25, 2))
                self.add('konw', knumh=knumh, kopos=1, klfn1=1, kstbw=1000.0, kbetr=2.0)
        for b in self.co:   # a service contract with a billing plan, a shipment with handling units, outputs
            vb = self.num('so', 1001)
            kunnr = self.cust[b][-1]
            self.add('vbak', vbeln=vb, auart='CS', vbtyp='G', audat='20260101', erdat='20260101', ernam='CB9980000010', vkorg=b, vtweg='10', spart='00', kunnr=kunnr,
                     waerk=self.co[b]['waers'], netwr=12000.0, gbstk='B')
            self.add('vbap', vbeln=vb, posnr=10, matnr='SV01', arktx=self.text.get('SV01', 'Service'), pstyv='TAD', kwmeng=12, vrkme='H', meins='H', netpr=1000.0,
                     netwr=12000.0, waerk=self.co[b]['waers'], werks=b, gbsta='B', fksaa='B')
            fpl = self.num('fpla', 1)
            self.add('veda', vbeln=vb, vposn=0, vbegdat='20260101', venddat='20261231', vkuesch='0001', vlaufz='12')
            self.add('fpla', fplnr=fpl, fpart='02', bedat='20260101', endat='20261231', horiz='12')
            for m in range(1, 13):
                self.add('fplt', fplnr=fpl, fpltr=m, afdat=ymd(day(m, 1)), fakwr=1000.0, fksaf='C' if m <= 10 else 'A', waers=self.co[b]['waers'])
            tk = self.num('vttk', 1)
            self.add('vttk', tknum=tk, shtyp='0001', tplst=b, tdlnr=self.supp[b][0], erdat='20260310', ernam='CB9980000020', stdis='C', streg='C', stlbg='C', stabf='C')
            dlvs = [r['vbeln'] for r in self.out['likp'] if r['vstel'] == b][:2]
            for i, d_ in enumerate(dlvs, 1): self.add('vttp', tknum=tk, tpnum=i, vbeln=d_)
            for i, d_ in enumerate(dlvs, 1):
                hu = self.num('venum', 1)
                self.add('vekp', venum=hu, exidv=f'00{rnd.randint(10**15, 10**16 - 1)}', vhilm='PK01', brgew=25.0, gewei='KG', vpobj='01', vpobjkey=d_, werks=b)
                for r in [x for x in self.out['lips'] if x['vbeln'] == d_]:
                    self.add('vepo', venum=hu, vepos=int(r['posnr']), vbeln=d_, posnr=r['posnr'], vemng=r['lfimg'], vemeh='PC', matnr=r['matnr'], werks=b)
        for r in self.out['vbrk']:
            self.add('nast', kappl='V3', objky=r['vbeln'], kschl='RD00', spras='E', parnr=r['kunag'], parvw='RE', erdat=r['fkdat'], eruhr='071500', nacha='1', vstat='1', anzal=1)
        for r in self.out['vbak'][:6]:
            self.add('nast', kappl='V1', objky=r['vbeln'], kschl='BA00', spras='E', parnr=r['kunnr'], parvw='AG', erdat=r['erdat'], eruhr='094000', nacha='5', vstat='1', anzal=1)

    def matdoc(self, mblnr, mjahr, zeile, bwart, matnr, werks, lgort, qty, value, cur, budat, **more):
        self.add('matdoc', mblnr=mblnr, mjahr=mjahr, zeile=zeile, key1=mblnr, key2=mjahr, key3=str(zeile).zfill(4), key4=mblnr, key5=mjahr, key6=str(zeile).zfill(4),
                 bwart=bwart, matnr=matnr, werks=werks, lgort=lgort, shkzg='S' if qty > 0 else 'H', menge=abs(qty), meins=self.mara.get(matnr, {}).get('meins', 'PC'),
                 erfmg=abs(qty), erfme=self.mara.get(matnr, {}).get('meins', 'PC'), stock_qty=qty, dmbtr=abs(value), waers=cur, budat=budat, bldat=budat, cpudt=budat,
                 cputm='103000', usnam=more.pop('usnam', rnd.choice(self.users)), record_type='MDOC', lbbsa='01', **more)

    def procurement(self):
        mats = {'1010': ['RM12', 'RM13', 'TG11', 'PK01'], '1710': ['RM12', 'TG12', 'TG13', 'OS01'], '4110': ['RM13', 'TG14', 'TG15', 'OS01']}
        for b in self.co:
            cur, (_, taxrate, _, vtax) = self.co[b]['waers'], self.region[b]
            supp = self.supp[b]
            for i, m in enumerate(mats[b]):
                lifnr = supp[i % len(supp)]
                infnr = self.num('infnr', 5300000001)
                price = round(self.price.get((m, b), 20.0), 2)
                self.add('eina', infnr=infnr, matnr=m, lifnr=lifnr, matkl=self.mara.get(m, {}).get('matkl', ''), meins='PC', idnlf=f'{lifnr[-3:]}-{m}', erdat='20250901', ernam='CB9980000010')
                self.add('eine', infnr=infnr, ekorg=b, esokz='0', werks=b, netpr=price, peinh=1, aplfz=7, norbm=100.0, minbm=10.0, waers=cur, ekgrp='001', mwskz=vtax, bprme='PC')
                self.add('eord', matnr=m, werks=b, zeord=1, vdatu='20260101', bdatu='99991231', lifnr=lifnr, ekorg=b, flifn='X' if i == 0 else '', notkz='', erdat='20251201', ernam='CB9980000010')
                self.add('a017', kappl='M', kschl='PB00', lifnr=lifnr, matnr=m, ekorg=b, werks=b, esokz='0', datbi='99991231', datab='20260101', knumh=self.num('knumh', 1))
                self.add('a018', kappl='M', kschl='PB00', lifnr=lifnr, matnr=m, ekorg=b, esokz='0', datbi='99991231', datab='20260101', knumh=self.num('knumh', 1))
                if i == 0: self.add('equk', qunum=self.num('qunum', 1), matnr=m, werks=b, vdatu='20260101', bdatu='20261231')
            for p in range(4):
                banfn = self.num('banfn', 10000001)
                m = mats[b][p]
                lifnr = supp[p % len(supp)]
                qty = rnd.choice([50, 100, 150, 200])
                badat = ymd(day(2 + p * 2, 3 + p))
                po = p < 3
                ebeln = self.num('ebeln', 4500000001) if po else ''
                self.add('eban', banfn=banfn, bnfpo=10, bsart='NB', bstyp='B', matnr=m, txz01=self.text.get(m, m), werks=b, lgort=self.slocs[b][0], menge=qty, meins='PC',
                         badat=badat, lfdat=plus(badat, 21), ekgrp='001', ekorg=b, flief=lifnr, knttp='', ebeln=ebeln, ebelp=10 if po else '', frgkz='2', loekz='',
                         afnam=rnd.choice(self.users), ernam=rnd.choice(self.users), erdat=badat, preis=round(self.price.get((m, b), 20), 2), waers=cur, statu='B' if po else 'N')
                if p == 3:
                    self.add('ebkn', banfn=banfn, bnfpo=10, zebkn=1, kostl=self.cc[b][0], sakto='0061000000', aufnr='', ps_psp_pnr='')
                if not po: continue
                bedat = plus(badat, 2)
                price = round(self.price.get((m, b), 20.0), 2)
                value = round(qty * price, 2)
                knumv = self.num('knumv', 1)
                self.add('ekko', ebeln=ebeln, bukrs=b, bstyp='F', bsart='NB', lifnr=lifnr, ekorg=b, ekgrp='001', bedat=bedat, waers=cur, zterm='NT30', inco1='FCA',
                         knumv=knumv, frgke='2', statu='9', loekz='', aedat=bedat, ernam=rnd.choice(self.users), spras='E', wkurs=1.0, adrnr='')
                self.add('ekpo', ebeln=ebeln, ebelp=10, matnr=m, txz01=self.text.get(m, m), werks=b, lgort=self.slocs[b][0], matkl=self.mara.get(m, {}).get('matkl', ''),
                         menge=qty, meins='PC', bprme='PC', netpr=price, peinh=1, netwr=value, brtwr=value, pstyp='0', knttp='', elikz='', erekz='', wepos='X', repos='X',
                         webre='X', mwskz=self.region[b][3], banfn=banfn, bnfpo=10, infnr='', loekz='', aedat=bedat, prdat=bedat)
                self.add('eket', ebeln=ebeln, ebelp=10, etenr=1, eindt=plus(bedat, 14), menge=qty, wemng=0.0, banfn=banfn, bnfpo=10, charg='', slfdt=plus(bedat, 14))
                self.add('ekes', ebeln=ebeln, ebelp=10, etens=1, ebtyp='AB', eindt=plus(bedat, 14), menge=qty, erdat=plus(bedat, 1), vbeln='')
                self.add('ekpa', ebeln=ebeln, ekorg=b, ltsnr='', werks='', parvw='LF', parza=0, lifn2=lifnr)
                self.add('ekpa', ebeln=ebeln, ekorg=b, ltsnr='', werks='', parvw='RS', parza=0, lifn2=lifnr)
                self.add('prcd_elements', knumv=knumv, kposn=10, stunr=10, zaehk=1, kschl='PB00', kbetr=price, kpein=1, kmein='PC', kwert=value, waers=cur, kawrt=qty, koaid='B', kherk='A')
                # goods receipt
                gr_date = plus(bedat, 14)
                mblnr = self.num('matdoc', 4900000001)
                self.matdoc(mblnr, gr_date[:4], 1, '101', m, b, self.slocs[b][0], qty, value, cur, gr_date, ebeln=ebeln, ebelp=10, lifnr=lifnr, kzbew='B', bktxt=f'GR PO {ebeln.lstrip("0")}',
                            vgart='WE', xblnr=f'DN-{rnd.randint(1000, 9999)}')
                self.add('ekbe', ebeln=ebeln, ebelp=10, zekkn=0, vgabe='1', gjahr=gr_date[:4], belnr=mblnr, buzei=1, bewtp='E', bwart='101', budat=gr_date, menge=qty, dmbtr=value,
                         wrbtr=value, waers=cur, shkzg='S', lfbnr=mblnr, lfgja=gr_date[:4], lfpos=1, matnr=m, werks=b, cpudt=gr_date, ernam=rnd.choice(self.users))
                for r in self.out['eket']:
                    if r['ebeln'] == ebeln: r['wemng'] = qty
                for r in self.out['ekpo']:
                    if r['ebeln'] == ebeln: r['elikz'] = 'X'
                fi = self.num(f'fi_we_{b}', 5000000001)
                self.journal(b, fi, 'WE', gr_date, [self.gl(b, 'S', '0013100000', value, koart='M', matnr=m, werks=b, msl=qty, runit='PC', ebeln=ebeln, ebelp=10, sgtxt='Inventory'),
                                                    self.gl(b, 'H', '0021500000', value, koart='S', ebeln=ebeln, ebelp=10, lifnr=lifnr, sgtxt='GR/IR')], awtyp='MKPF', awref=mblnr, tcode='MIGO')
                if p == 2: continue                                   # received, not invoiced yet
                inv = self.num('rbkp', 5105600001)
                idate = plus(gr_date, 5)
                tax = round(value * taxrate / 100, 2)
                fi = self.num(f'fi_re_{b}', 5100000001)
                self.add('rbkp', belnr=inv, gjahr=idate[:4], bukrs=b, lifnr=lifnr, bldat=idate, budat=idate, xblnr=f'INV-{lifnr[-3:]}-{inv[-4:]}', rmwwr=round(value + tax, 2),
                         wmwst1=tax, waers=cur, rbstat='5', zterm='NT30', blart='RE', usnam=rnd.choice(self.users), cpudt=idate, ivtyp='', stblg='', kursf=1.0)
                self.add('rseg', belnr=inv, gjahr=idate[:4], buzei=1, ebeln=ebeln, ebelp=10, matnr=m, werks=b, wrbtr=value, menge=qty, bstme='PC', mwskz=self.region[b][3],
                         lfbnr=mblnr, lfgja=gr_date[:4], lfpos=1, shkzg='S', bukrs=b, kschl='')
                self.add('ekbe', ebeln=ebeln, ebelp=10, zekkn=0, vgabe='2', gjahr=idate[:4], belnr=inv, buzei=1, bewtp='Q', bwart='', budat=idate, menge=qty, dmbtr=value,
                         wrbtr=value, waers=cur, shkzg='S', lfbnr=mblnr, lfgja=gr_date[:4], lfpos=1, matnr=m, werks=b, cpudt=idate, ernam=rnd.choice(self.users))
                for r in self.out['ekpo']:
                    if r['ebeln'] == ebeln: r['erekz'] = 'X'
                self.journal(b, fi, 'RE', idate, [self.gl(b, 'S', '0021500000', value, koart='S', ebeln=ebeln, ebelp=10, sgtxt='GR/IR clearing'),
                                                  self.gl(b, 'S', '0016100000', tax, koart='S', ktosl='VST', mwskz=self.region[b][3], base=value, sgtxt='Input tax'),
                                                  self.gl(b, 'H', '0021100000', round(value + tax, 2), koart='K', lifnr=lifnr, zterm='NT30', sgtxt=f'Invoice {inv}')],
                             awtyp='RMRP', awref=inv, xblnr=f'INV-{lifnr[-3:]}-{inv[-4:]}', tcode='MIRO')
                if b == '4110':
                    self.add('with_item', bukrs=b, belnr=fi, gjahr=idate[:4], buzei=3, witht='J1', wt_withcd='94', wt_qsshb=value, wt_qsshh=value, wt_qbshh=round(value * 0.02, 2))
                if p == 0:                                           # paid by the payment run
                    pay = self.num(f'fi_kz_{b}', 1500000001)
                    pdate = plus(idate, 25)
                    amount = round(value + tax, 2)
                    self.journal(b, pay, 'KZ', pdate, [self.gl(b, 'S', '0021100000', amount, koart='K', lifnr=lifnr, augbl=pay, augdt=pdate, sgtxt='Payment'),
                                                       self.gl(b, 'H', '0010010000', amount, koart='S', sgtxt='Bank')], tcode='F110')
                    self.clear(b, fi, idate[:4], 3, pay, pdate)
                    laufi = f'{b[:2]}PAY1'
                    self.add('reguh', laufd=pdate, laufi=laufi, xvorl='', zbukr=b, lifnr=lifnr, kunnr='', empfg='', vblnr=pay, waers=cur, rbetr=-amount, rwbtr=-amount,
                             rzawe='T' if b != '1710' else 'C', hbkid={'1010': 'DEUT1', '1710': 'CITI1', '4110': 'HDFC1'}[b], hktid='CHK01', valut=pdate, name1=self.lfa1[lifnr]['name1'])
                    self.add('regup', laufd=pdate, laufi=laufi, xvorl='', zbukr=b, lifnr=lifnr, kunnr='', empfg='', vblnr=pay, bukrs=b, belnr=fi, gjahr=idate[:4], buzei=3,
                             dmbtr=amount, wrbtr=amount, shkzg='H', blart='RE', xblnr=f'INV-{lifnr[-3:]}-{inv[-4:]}')
                    if b == '1710':
                        self.add('payr', zbukr=b, hbkid='CITI1', hktid='CHK01', rzawe='C', chect=f'{100001 + p:06d}', lifnr=lifnr, vblnr=pay, gjahr=pdate[:4], zaldt=pdate,
                                 rwbtr=-amount, waers=cur, znme1=self.lfa1[lifnr]['name1'], laufd=pdate, laufi=laufi)
                if p == 1:
                    self.add('rbco', belnr=inv, gjahr=idate[:4], buzei=1, cobl_nr=1, saknr='0050000100', kostl=self.cc[b][0], aufnr='', wrbtr=value, menge=qty, bstme='PC', shkzg='S', mwskz=self.region[b][3])
                    self.add('ekkn', ebeln=ebeln, ebelp=10, zekkn=1, sakto='0050000100', kostl=self.cc[b][0], aufnr='', ps_psp_pnr='', anln1='', vbeln='', prctr='YB101', menge=qty)
                    self.add('ekbz', ebeln=ebeln, ebelp=10, stunr=20, zaehk=1, vgabe='1', gjahr=gr_date[:4], belnr=mblnr, buzei=1, bewtp='F', menge=qty, dmbtr=round(value * 0.03, 2), waers=cur)
            # one-time customer invoice (BSEC) and a plan / consolidation line
            fi = self.num(f'fi_dr_{b}', 1800000001)
            self.journal(b, fi, 'DR', ymd(day(6, 15)), [self.gl(b, 'S', '0012100000', 500.0, koart='D', kunnr=self.cust[b][0], sgtxt='One-time customer'),
                                                         self.gl(b, 'H', '0041000000', 500.0, koart='S', sgtxt='Revenue one-time')], tcode='FB70')
            self.add('bsec', bukrs=b, belnr=fi, gjahr='2026', buzei=1, name1='Walk-in Customer', ort01=self.co[b]['ort01'], land1=self.co[b]['land1'], pstlz='00000', stras='Market Street 1', spras='E')
            for i, (acct, amount) in enumerate([('0041000000', -250000.0), ('0050000100', 160000.0), ('0063000000', 50000.0)], 1):
                self.add('acdocp', rldnr='0L', rbukrs=b, gjahr='2026', belnr=f'PL{b}0001', docln=i, category='PLN', racct=acct, hsl=amount, rhcur=self.co[b]['waers'], poper='012',
                         rcntr=self.cc[b][0], prctr='YB101', budat='20261231', plevl='Y1')
            self.add('acdocu', rldnr='Y1', rvers='Y10', ryear='2026', docnr=f'C{b}0001', docln=1, rbunit=b, racct='0041000000', hsl=-100000.0, rhcur=self.co[b]['waers'], poper='012',
                     rtcur=self.co[b]['waers'], kslu=-100000.0 / self.fx(b))
            self.add('fqm_flow', flow_id=f'FQM{b}0001', bukrs=b, flow_type='AR', amount=10000.0, waers=self.co[b]['waers'], value_date='20261130', origin='SD')

    def inventory(self):
        for b in self.co:
            cur = self.co[b]['waers']
            sl = self.slocs[b]
            mb = self.num('matdoc', 4900000001)
            self.matdoc(mb, '2026', 1, '311', 'TG11', b, sl[0], -5, 5 * self.price.get(('TG11', b), 10), cur, '20260520', umlgo=sl[1], bktxt='Transfer to second storage location')
            self.matdoc(mb, '2026', 2, '311', 'TG11', b, sl[1], 5, 5 * self.price.get(('TG11', b), 10), cur, '20260520', umlgo=sl[0], bktxt='Transfer to second storage location')
            mb = self.num('matdoc', 4900000001)
            self.matdoc(mb, '2026', 1, '201', 'OS01', b, sl[0], -2, 2 * self.price.get(('OS01', b), 10), cur, '20260611', kostl=self.cc[b][0], bktxt='Office supplies for cost center')
            mb = self.num('matdoc', 4900000001)
            self.matdoc(mb, '2026', 1, '551', 'TG13', b, sl[0], -1, self.price.get(('TG13', b), 10), cur, '20260702', bktxt='Scrapping damaged goods', kostl=self.cc[b][0])
            # physical inventory: counted, one difference
            ib = self.num('iblnr', 100000001)
            self.add('ikpf', iblnr=ib, gjahr='2026', werks=b, lgort=sl[0], gidat='20260930', zldat='20260930', dstat='X', usnam='CB9980000020', budat='20260930')
            for z, m in enumerate(['TG12', 'TG14'], 1):
                book = float(next((x['labst'] for x in self.D['mard'] if x['matnr'] == m and x['werks'] == b and x['lgort'] == sl[0]), 10) or 10)
                counted = book - (1 if z == 2 else 0)
                self.add('iseg', iblnr=ib, gjahr='2026', zeili=z, matnr=m, werks=b, lgort=sl[0], charg='', buchm=book, menge=counted, meins='PC', xzael='X', xdiff='X' if counted != book else '',
                         xnull='', dmbtr=round((book - counted) * self.price.get((m, b), 10), 2), waers=cur)
                if counted != book:
                    mb = self.num('matdoc', 4900000001)
                    self.matdoc(mb, '2026', 1, '702', m, b, sl[0], counted - book, round((book - counted) * self.price.get((m, b), 10), 2), cur, '20260930', bktxt=f'Inventory difference {ib}')
            # stock history and valuation history (previous periods)
            for r in [x for x in self.D['mard'] if x['werks'] == b][:6]:
                for mon in (8, 9):
                    self.add('mardh', matnr=r['matnr'], werks=b, lgort=r['lgort'], lfgja='2026', lfmon=mon, labst=float(r['labst'] or 0) + mon - 8, insme=0.0, speme=0.0)
            for r in [x for x in self.D['mbew'] if x['bwkey'] == b][:6]:
                for mon in (8, 9):
                    self.add('mbewh', matnr=r['matnr'], bwkey=b, bwtar='', lfgja='2026', lfmon=mon, lbkum=float(r.get('lbkum') or 0), salk3=float(r.get('salk3') or 0),
                             vprsv=r.get('vprsv', 'V'), verpr=r.get('verpr', 0), stprs=r.get('stprs', 0), peinh=1)
            # batches of the raw materials
            for m in ('RM12', 'RM13'):
                for n_ in range(2):
                    charg = f'{b}{m[-2:]}{n_ + 1:04d}'
                    self.add('mch1', matnr=m, charg=charg, ersda='20260115', ernam='CB9980000010', vfdat='20271231', hsdat='20260110', lifnr=self.supp[b][0], licha=f'L{rnd.randint(10000, 99999)}')
                    self.add('mcha', matnr=m, werks=b, charg=charg, ersda='20260115', ernam='CB9980000010', vfdat='20271231')
                    self.add('mchb', matnr=m, werks=b, lgort=sl[0], charg=charg, clabs=50.0 + n_ * 25, cinsm=0.0, cspem=0.0, ersda='20260115')
        # initial stock (movement type 561, the first posting of the year): what MARD holds, and at least what the year's
        # movements take out, so no stock goes negative
        net = {}
        for r in self.out['matdoc']:
            k_ = (r['matnr'], r['werks'], r['lgort'])
            net[k_] = net.get(k_, 0) + float(r['stock_qty'])
        start = {(r['matnr'], r['werks'], r['lgort']): float(r['labst'] or 0) for r in self.D['mard']}
        for k_, q in net.items():
            if q < 0: start[k_] = max(start.get(k_, 0), -q + 10)
        mblnr = self.num('matdoc', 4900000001)
        for i, ((m, w, l), qty) in enumerate(sorted((k_, q) for k_, q in start.items() if q > 0), 1):
            if i % 40 == 0: mblnr = self.num('matdoc', 4900000001)
            b = next(x['bwkey'] for x in self.D['t001w'] if x['werks'] == w)
            self.matdoc(mblnr, '2026', i % 40 or 40, '561', m, w, l, qty, round(qty * self.price.get((m, b), 10), 2), self.co[b]['waers'], '20260102',
                        bktxt='Initial stock', vgart='WA', usnam='CB9980000010')
        # aggregated stock (as the S/4 stock extract keeps it)
        agg = {}
        for r in self.out['matdoc']:
            key = (r['matnr'], r['werks'], r['lgort'], r['charg'], r['sobkz'], r['lbbsa'] or '01')
            agg[key] = agg.get(key, 0) + float(r['stock_qty'])
        for (m, w, l, c, s, lb), q in agg.items():
            b = next(x['bwkey'] for x in self.D['t001w'] if x['werks'] == w)
            self.add('matdoc_extract', matnr=m, werks=w, lgort=l, charg=c, sobkz=s, lbbsa=lb, stock_qty=round(q, 3), meins=self.mara.get(m, {}).get('meins', 'PC'),
                     value_lc=round(q * self.price.get((m, b), 10), 2), waers=self.co[b]['waers'])

    def production(self):
        b = '1010'
        cur = self.co[b]['waers']
        boms = {'FG126': [('SG23', 1), ('RM12', 2), ('PK01', 1)], 'SG23': [('RM12', 1), ('RM13', 4)]}
        for i, (m, comps) in enumerate(boms.items(), 1):
            stlnr = str(i).zfill(8)
            for w in ('1010', '1710'):
                self.add('mast', matnr=m, werks=w, stlan='1', stlnr=stlnr, stlal='01', andat='20250601', annam='CB9980000010')
            self.add('stko', stlty='M', stlnr=stlnr, stlal='01', stkoz=1, datuv='20250601', bmeng=1.0, bmein='PC', stlst='01', stktx=f'BOM {self.text.get(m, m)}', andat='20250601', annam='CB9980000010')
            for j, (c, q) in enumerate(comps, 1):
                self.add('stpo', stlty='M', stlnr=stlnr, stlkn=j, stpoz=j, datuv='20250601', idnrk=c, posnr=f'{j * 10:04d}', postp='L', menge=float(q), meins='PC', sanka='X',
                         andat='20250601', annam='CB9980000010', ausch=0.0)
                self.add('stas', stlty='M', stlnr=stlnr, stlal='01', stlkn=j, stasz=j, datuv='20250601', andat='20250601')
        wcs = [('10000001', 'ASSEMBLY', 'Assembly line', '10101301'), ('10000002', 'PACKING', 'Packing station', '10101301'), ('10000003', 'MAINT', 'Maintenance workshop', '10101201')]
        for objid, arbpl, txt, kostl in wcs:
            self.add('crhd', objty='A', objid=objid, arbpl=arbpl, werks=b, verwe='0001' if arbpl != 'MAINT' else '0005', ktext=txt, kapid=objid, begda='20250101', endda='99991231', veran='001')
            self.add('crco', objty='A', objid=objid, laset=1, endda='99991231', lanum=1, begda='20250101', kokrs='A000', kostl=kostl, lstar='LAB001')
            self.add('kako', kapid=objid, kapar='001', name=arbpl, ktext=txt, begzt=28800.0, endzt=61200.0, ngrad=85, aznor=2)
        for i, (m, ops) in enumerate([('FG126', [('0010', '10000001', 'Assemble'), ('0020', '10000002', 'Pack')]), ('SG23', [('0010', '10000001', 'Pre-assemble')])], 1):
            plnnr = str(50000000 + i).zfill(8)
            self.add('plko', plnty='N', plnnr=plnnr, plnal='01', zaehl=1, datuv='20250601', werks=b, verwe='1', statu='4', losvn=1.0, losbs=99999.0, plnme='PC', ktext=f'Routing {self.text.get(m, m)}')
            self.add('mapl', matnr=m, werks=b, plnty='N', plnnr=plnnr, plnal='01', zkriz=0, zaehl=1, datuv='20250601', loekz='')
            for j, (vornr, arbid, txt) in enumerate(ops, 1):
                self.add('plpo', plnty='N', plnnr=plnnr, plnkn=j, zaehl=1, vornr=vornr, arbid=arbid, steus='PP01', ltxa1=txt, vgw01=30.0, vge01='MIN', vgw02=15.0, vge02='MIN', werks=b, datuv='20250601')
                self.add('plas', plnty='N', plnnr=plnnr, plnal='01', plnfl='000000', plnkn=j, zaehl=1, datuv='20250601', loekz='')
            self.add('mkal', matnr=m, werks=b, verid='0001', text1=f'Production version {m}', adatu='20250601', bdatu='99991231', plnty='N', plnnr=plnnr, alnal='01', stlal='01', stlan='1')
        for i in range(3):
            plnum = self.num('plaf', 1)
            self.add('plaf', plnum=plnum, matnr='FG126', plwrk=b, pwwrk=b, paart='LA', gsmng=float(20 + i * 10), meins='PC', psttr=ymd(day(11, 10 + i * 5)), pedtr=ymd(day(11, 14 + i * 5)),
                     dispo='001', beskz='E', verid='0001', trmer='')
        for i, (qty, status) in enumerate([(50, ['I0002', 'I0009', 'I0012', 'I0045']), (30, ['I0002', 'I0010']), (40, ['I0001'])]):
            aufnr = self.num('aufnr_pp', 1000001, 12)
            objnr = f'OR{aufnr}'
            start = ymd(day(3 + i * 3, 2))
            aufpl = self.num('aufpl', 1)
            self.add('aufk', aufnr=aufnr, autyp='10', auart='YBM1', ktext=f'Production FG126 lot {i + 1}', bukrs=b, werks=b, kokrs='A000', kostv='10101301', prctr='YB102',
                     erdat=start, ernam='PRIYA.SHARMA', objnr=objnr, waers=cur, astnr='')
            done = qty if 'I0012' in status else (qty // 2 if 'I0010' in status else 0)
            self.add('afko', aufnr=aufnr, gamng=float(qty), gmein='PC', gstrp=start, gltrp=plus(start, 5), gstrs=start, gltrs=plus(start, 5), plnbez='FG126', plnty='N',
                     plnnr='50000001', plnal='01', stlnr='00000001', stlal='01', aufpl=aufpl, dispo='001', fevor='001', rsnum=self.num('rsnum', 1), ftrmi=start if 'I0002' in status else '',
                     getri=plus(start, 4) if 'I0012' in status else '', igmng=float(done))
            self.add('afpo', aufnr=aufnr, posnr=1, matnr='FG126', psmng=float(qty), wemng=float(done), amein='PC', meins='PC', pwerk=b, dwerk=b, lgort='101A', verid='0001',
                     dauat='YBM1', elikz='X' if 'I0012' in status else '', ltrmi=plus(start, 4) if done else '')
            for j, (vornr, arbid, txt) in enumerate([('0010', '10000001', 'Assemble'), ('0020', '10000002', 'Pack')], 1):
                aplzl = j
                self.add('afvc', aufpl=aufpl, aplzl=aplzl, vornr=vornr, arbid=arbid, steus='PP01', ltxa1=txt, werks=b, objnr=f'OV{aufpl}{j:08d}', rueck=self.num('rueck', 1, 10), rmzhl=0)
                self.add('afvv', aufpl=aufpl, aplzl=aplzl, mgvrg=float(qty), meinh='PC', vgw01=30.0, vge01='MIN', ism01=float(done) * 0.5, lmnga=float(done), fsavd=start, fsedd=plus(start, 5))
                if done:
                    rueck = next(r['rueck'] for r in self.out['afvc'] if r['aufpl'] == aufpl and int(r['aplzl']) == aplzl)
                    self.add('afru', rueck=rueck, rmzhl=1, aufnr=aufnr, vornr=vornr, arbid=arbid, werks=b, lmnga=float(done), xmnga=1.0 if j == 1 else 0.0, gmein='PC', ism01=float(done) * 0.5,
                             ile01='MIN', budat=plus(start, 3), ersda=plus(start, 3), ernam='PRIYA.SHARMA', aueru='X' if done == qty else '', stokz='', ltxa1='Confirmed')
            rsnum = next(r['rsnum'] for r in self.out['afko'] if r['aufnr'] == aufnr)
            self.add('rkpf', rsnum=rsnum, bdter=start, kostl='', aufnr=aufnr, bwart='261', usnam='PRIYA.SHARMA', rsdat=start)
            for j, (c, q) in enumerate(boms['FG126'], 1):
                self.add('resb', rsnum=rsnum, rspos=j, rsart='', matnr=c, werks=b, lgort='101A', bdmng=float(q * qty), enmng=float(q * done), meins='PC', bdter=start, aufnr=aufnr,
                         bwart='261', xloek='', kzear='X' if done == qty else '', schgt='', postp='L', posnr=f'{j * 10:04d}')
            if done:
                mb = self.num('matdoc', 4900000001)
                for j, (c, q) in enumerate(boms['FG126'], 1):
                    self.matdoc(mb, start[:4], j, '261', c, b, '101A', -q * done, round(q * done * self.price.get((c, b), 10), 2), cur, plus(start, 3), aufnr=aufnr, rsnum=rsnum, rspos=j,
                                bktxt=f'Components order {aufnr.lstrip("0")}', vgart='WF')
                mb = self.num('matdoc', 4900000001)
                self.matdoc(mb, start[:4], 1, '101', 'FG126', b, '101A', done, round(done * self.price.get(('FG126', b), 100), 2), cur, plus(start, 4), aufnr=aufnr, kzbew='F',
                            bktxt=f'Goods receipt order {aufnr.lstrip("0")}', vgart='WF')
            self.add('jsto', objnr=objnr, obtyp='ORI', stsma='')
            for s in status: self.add('jest', objnr=objnr, stat=s, inact='', chgnr='001')
        # kanban, forecast
        pk = self.num('pkhd', 1)
        self.add('pkhd', pknum=pk, matnr='RM12', werks=b, prvbe='PSA-01', behmg=50.0, behaz=3, pkstu='0001')
        for j in range(1, 4): self.add('pkps', pknum=pk, pkpos=j, pkbst='2' if j < 3 else '5', pkimg=50.0, saedt='20261020', pkbht='')
        for m in ('TG11', 'FG126'):
            pnum = self.num('pnum1', 1)
            self.add('mapr', matnr=m, werks=b, pnum1=pnum, prmod='D')
            for mon in range(1, 7): self.add('prop', pnum1=pnum, hsnum=0, versp=0, matnr=m, werks=b, perio=f'2026{mon + 6:02d}', prwrt=float(rnd.randint(20, 60)))

    def maintenance_quality(self):
        b = '1010'
        for i, (tp, txt) in enumerate([('1010-PROD', 'Production plant Hamburg'), ('1010-PROD-L01', 'Assembly line 1'), ('1010-UTIL', 'Utilities')]):
            iloan = self.num('iloan', 1, 12)
            self.add('iflot', tplnr=tp, fltyp='M', iwerk=b, swerk=b, objnr=f'IF{tp}', tplma=tp.rsplit('-', 1)[0] if tp.count('-') > 1 else '', iloan=iloan, erdat='20250301', ernam='CB9980000010')
            self.add('iflotx', tplnr=tp, spras='E', pltxt=txt)
            self.add('iloa', iloan=iloan, tplnr=tp, swerk=b, kostl='10101201', bukrs=b, gsber='', anlnr='', stort='HALL-1', msgrp='M1', beber='001')
        equis = []
        for i, (txt, eqart, herst) in enumerate([('Hydraulic press', 'PRESS', 'Schuler AG'), ('Conveyor belt', 'CONVEYOR', 'Interroll GmbH'), ('Air compressor', 'COMPRESSOR', 'Atlas Copco'), ('Packing robot', 'ROBOT', 'KUKA AG')]):
            equnr = str(10000001 + i).zfill(18)
            equis.append(equnr)
            self.add('equi', equnr=equnr, eqtyp='M', eqart=eqart, herst=herst, serge=f'SN-{rnd.randint(100000, 999999)}', matnr='', sernr='', baujj=str(2018 + i), objnr=f'IE{equnr}',
                     inbdt=ymd(day(1 + i, 15, 2019 + i)), erdat='20250301', ernam='CB9980000010')
            self.add('eqkt', equnr=equnr, spras='E', eqktx=txt)
            self.add('equz', equnr=equnr, datbi='99991231', eqlfn=1, datab='20250301', iwerk=b, tplnr='1010-PROD-L01' if i < 2 else '1010-UTIL', iloan=self.out['iloa'][1 if i < 2 else 2]['iloan'], gewrk='10000003')
            point = self.num('point', 1, 12)
            self.add('imptt', point=point, mpobj=f'IE{equnr}', psort='OPERATING-HOURS', atinn='0000000001', mrmin=0.0, mrmax=99999.0, indct='X')
            for r in range(3):
                self.add('imrg', mdocm=self.num('mdocm', 1, 20), point=point, idate=ymd(day(7 + r, 1)), itime='080000', recdv=float(1200 + r * 160 + i * 40), recdu='H', readr='JOHN.MILLER', vlcod='')
        for i, (txt, cycle) in enumerate([('Monthly press inspection', '1 MON'), ('Quarterly compressor service', '3 MON')]):
            warpl = self.num('warpl', 1, 12)
            wapos = self.num('wapos', 1, 16)
            self.add('mpla', warpl=warpl, wptxt=txt, strat='', mptyp='PM', erdat='20250401', ernam='CB9980000010', abrho=365, hunit='DAY')
            self.add('mpos', wapos=wapos, warpl=warpl, pstxt=txt, equnr=equis[0 if i == 0 else 2], tplnr='', iwerk=b, auart='PM02', gewrk='10000003', plnty='A', plnnr='')
            for c in range(1, 4): self.add('mhis', warpl=warpl, abnum=c, nplda=ymd(day(1 + c * (3 if i else 1), 5)), horda=ymd(day(1 + c * (3 if i else 1), 1)), tstat='X' if c < 3 else '')
        notifs = [('M2', 'Hydraulic oil leak at press', equis[0], '1', 'I0068'), ('M1', 'Belt tension too low', equis[1], '2', 'I0072'), ('M2', 'Compressor noise', equis[2], '3', 'I0068'), ('Q1', 'Damaged goods at goods receipt', '', '2', 'I0068')]
        for i, (art, txt, equnr, prio, stat) in enumerate(notifs):
            qmnum = self.num('qmnum', 10000001, 12)
            aufnr = ''
            if art in ('M1', 'M2') and i < 2:
                aufnr = self.num('aufnr_pm', 4000001, 12)
                self.add('aufk', aufnr=aufnr, autyp='30', auart='PM01', ktext=f'Repair: {txt}', bukrs=b, werks=b, kokrs='A000', kostv='10101201', prctr='YB900',
                         erdat=ymd(day(8, 5 + i)), ernam='JOHN.MILLER', objnr=f'OR{aufnr}', waers='EUR')
                self.add('afih', aufnr=aufnr, equnr=equnr, tplnr='1010-PROD-L01', iloan=self.out['iloa'][1]['iloan'], qmnum=qmnum, priok=prio, ilart='002', iwerk=b, ingpr='001', gewrk='10000003')
                self.add('jsto', objnr=f'OR{aufnr}', obtyp='ORI', stsma='')
                for s in (['I0002', 'I0045'] if i == 1 else ['I0002']): self.add('jest', objnr=f'OR{aufnr}', stat=s, inact='', chgnr='001')
            self.add('qmel', qmnum=qmnum, qmart=art, qmtxt=txt, qmdat=ymd(day(8, 3 + i)), mzeit='093000', erdat=ymd(day(8, 3 + i)), ernam='JOHN.MILLER', equnr=equnr, tplnr='1010-PROD-L01' if equnr else '',
                     priok=prio, aufnr=aufnr, matnr='TG11' if art == 'Q1' else '', mawerk=b if art == 'Q1' else '', lifnum=self.supp[b][0] if art == 'Q1' else '', objnr=f'QM{qmnum}',
                     qmkat='D', qmgrp='PM-1', qmcod='0001', strmn=ymd(day(8, 3 + i)), ltrmn=ymd(day(8, 10 + i)), iwerk=b)
            if art != 'Q1': self.add('qmih', qmnum=qmnum, equnr=equnr, iloan=self.out['iloa'][1]['iloan'], iwerk=b, ingrp='001', msaus='X' if prio == '1' else '', ausvn=ymd(day(8, 3 + i)), ausbs=ymd(day(8, 4 + i)))
            self.add('qmfe', qmnum=qmnum, fenum=1, fetxt=txt[:40], fekat='C', fegrp='PM-DAMG', fecod='0001', otkat='B', otgrp='PM-PART', oteil='0002', erzdatum=ymd(day(8, 3 + i)))
            self.add('qmur', qmnum=qmnum, fenum=1, urnum=1, urtxt='Wear and tear', urkat='5', urgrp='PM-CAUS', urcod='0003')
            self.add('qmma', qmnum=qmnum, manum=1, matxt='Inspected on site', mnkat='A', mngrp='PM-ACT', mncod='0001', erdat=ymd(day(8, 4 + i)))
            self.add('qmsm', qmnum=qmnum, manum=1, matxt='Replace part', mnkat='2', mngrp='PM-TASK', mncod='0002', mngfa='X' if i == 1 else '', pster=ymd(day(8, 6 + i)), peter=ymd(day(8, 8 + i)))
            self.add('jsto', objnr=f'QM{qmnum}', obtyp='QMI', stsma='')
            self.add('jest', objnr=f'QM{qmnum}', stat=stat, inact='', chgnr='001')
        # quality: master characteristics, inspection lots from goods receipts and production, results, usage decisions
        for i, (mkmnr, txt) in enumerate([('DIM-01', 'Length'), ('VIS-01', 'Visual inspection'), ('WGT-01', 'Weight')]):
            self.add('qpmk', zaehler=b, mkmnr=mkmnr, version=1, kurztext=txt, gueltigab='20250101', loekz='')
        for m in ('RM12', 'RM13'):
            self.add('qinf', matnr=m, lieferant=self.supp[b][0], werk=b, frei_dat='20261231', sperrfkt='', zertifkat='X', noinsp='')
        lots = [r for r in self.out['matdoc'] if r['werks'] == b and r['bwart'] == '101'][:4]
        for i, gr in enumerate(lots):
            prueflos = str(10000000001 + i).zfill(12)
            self.add('qals', prueflos=prueflos, art='01' if gr['ebeln'] else '04', herkunft='01' if gr['ebeln'] else '03', matnr=gr['matnr'], werk=b, lagortchrg=gr['lgort'],
                     losmenge=float(gr['menge']), mengeneinh=gr['meins'], mblnr=gr['mblnr'], mjahr=gr['mjahr'], zeile=gr['zeile'], ebeln=gr['ebeln'], ebelp=gr['ebelp'],
                     aufnr=gr['aufnr'], lifnr=gr['lifnr'], enstehdat=gr['budat'], entstezeit='103000', ersteller='JOHN.MILLER', pastrterm=gr['budat'], paendterm=plus(gr['budat'], 2),
                     objnr=f'QL{prueflos}', stat35='X' if i < 3 else '')
            for j, (merk, txt, target) in enumerate([('0010', 'Length (mm)', 120.0), ('0020', 'Visual inspection', 0.0)], 1):
                self.add('qamv', prueflos=prueflos, vorglfnr='00000001', merknr=merk, kurztext=txt, verwmerkm='DIM-01' if j == 1 else 'VIS-01', sollwert=target, toleranzob=target + 0.5,
                         toleranzun=target - 0.5, masseinhsw='MM' if j == 1 else '', steuerkz='X', stichprver='SAMPLE5')
                mean = round(target + rnd.uniform(-0.3, 0.3), 3) if target else 0.0
                self.add('qamr', prueflos=prueflos, vorglfnr='00000001', merknr=merk, mittelwert=mean, anzwertg=5, mbewertg='A', pruefer='JOHN.MILLER', pruefdatuv=plus(gr['budat'], 1))
                if j == 1:
                    for s in range(1, 4): self.add('qase', prueflos=prueflos, vorglfnr='00000001', merknr=merk, detailerg=s, messwert=round(target + rnd.uniform(-0.4, 0.4), 3), mbewertg='A')
            if i < 3: self.add('qave', prueflos=prueflos, kzart='L', zaehler=1, vcode='A' if i != 2 else 'R', vbewertung='A' if i != 2 else 'R', vdatum=plus(gr['budat'], 2), vezeiterf='160000', vname='JOHN.MILLER', vauswahlmg='01', vcodegrp='01')

    def assets_projects_co(self):
        for anlkl, txt in {'1000': 'Buildings', '2000': 'Machinery and equipment', '3000': 'Fixtures and fittings', '3100': 'Vehicles', '3200': 'IT hardware'}.items():
            self.add('anka', anlkl=anlkl, txk20=txt[:20], txk50=txt, ktogr=anlkl, xanlgr='')
        for b in self.co:
            cur = self.co[b]['waers']
            for i, (anlkl, txt, value, years) in enumerate([('2000', 'CNC machine', 85000.0, 10), ('3100', 'Delivery van', 42000.0, 6), ('3200', 'Server rack', 18000.0, 4)]):
                value = round(value / self.fx(b) * self.fx('1710'), 2) if b != '1710' else value
                anln1 = str(10000000 + i + 1).zfill(12)
                aktiv = ymd(day(2 + i, 1, 2024))
                self.add('anla', bukrs=b, anln1=anln1, anln2='0000', anlkl=anlkl, txt50=txt, txa50=f'{txt} {b}', invnr=f'INV-{b}-{i + 1:03d}', aktiv=aktiv, deakt='', zugdt=aktiv,
                         ernam='MARCO.ROSSI', erdat=aktiv, menge=1.0, meins='PC', lifnr=self.supp[b][0], herst='Various', ord41='')
                self.add('anlh', bukrs=b, anln1=anln1, anlhtxt=txt, lanep=1)
                self.add('anlz', bukrs=b, anln1=anln1, anln2='0000', bdatu='99991231', adatu=aktiv, kostl=self.cc[b][0], werks=b, gsber='', prctr='YB101', stort='', raumn='', pernr='')
                for afabe in ('01', '15'):
                    self.add('anlb', bukrs=b, anln1=anln1, anln2='0000', afabe=afabe, bdatu='99991231', afasl='LINA', ndjar=years, ndper=0, afabg=aktiv)
                    self.add('faat_ydda', bukrs=b, anln1=anln1, anln2='0000', gjahr='2026', afabe=afabe, kansw=value, knafa=-round(value / years * 2, 2), nafag=-round(value / years, 2), waers=cur)
                    for per in range(1, 13):
                        self.add('faat_plan_values', bukrs=b, anln1=anln1, anln2='0000', gjahr='2026', afabe=afabe, poper=per, nafap=-round(value / years / 12, 2), waers=cur)
                self.add('faat_doc_it', bukrs=b, anln1=anln1, anln2='0000', gjahr=aktiv[:4], awref=f'AA{anln1[-6:]}', awitem=1, afabe='01', subta=1, anbwa='100', anbtr=value, waers=cur, budat=aktiv)
            # controlling: activity types, prices, a CO document, cost center group, internal orders, material ledger
            for lstar, txt in {'LAB001': 'Labour hours', 'MCH001': 'Machine hours'}.items():
                if b == '1010': self.add('csla', kokrs='A000', lstar=lstar, datbi='99991231', datab='20250101', leinh='H', latyp='1', ktext=txt)
                self.add('cssl', kokrs='A000', objnr=f'KLA000{self.cc[b][0]}{lstar}', gjahr='2026', lstar=lstar, tkg001=55.0 if lstar == 'LAB001' else 80.0, waers=cur)
            cobk = self.num('cobk', 100000001)
            self.add('cobk', kokrs='A000', belnr=cobk, gjahr='2026', budat='20260630', bldat='20260630', vrgng='RKU1', usnam='MARCO.ROSSI', bltxt='Reposting of costs', refbn='', awtyp='COBK')
            for i, (auart, txt) in enumerate([('Y1MK', 'Trade fair 2026'), ('Y1TR', 'Sales training')]):
                aufnr = self.num('aufnr_co', 100000001, 12)
                self.add('aufk', aufnr=aufnr, autyp='01', auart=auart, ktext=txt, bukrs=b, werks=b, kokrs='A000', kostv=self.cc[b][0], prctr='YB101', erdat='20260115', ernam='MARCO.ROSSI',
                         objnr=f'OR{aufnr}', waers=cur)
                fi = self.num(f'fi_sa_{b}', 100000001)
                self.journal(b, fi, 'SA', ymd(day(4 + i, 20)), [self.gl(b, 'S', '0065300000', 1200.0 + i * 400, koart='S', aufnr=aufnr, rcntr=self.cc[b][0], prctr='YB101', sgtxt=txt),
                                                                 self.gl(b, 'H', '0010010000', 1200.0 + i * 400, koart='S', sgtxt='Bank')], tcode='FB50')
            for m in ('TG11', 'TG12', 'FG126'):
                kalnr = self.num('kalnr', 1, 12)
                self.add('ckmlhd', kalnr=kalnr, matnr=m, bwkey=b, bwtar='', mlast='3', abrechdat='20260930')
                for per in (9, 10):
                    p = self.price.get((m, b), 10)
                    self.add('ckmlcr', kalnr=kalnr, bdatj='2026', poper=per, untper=0, curtp='10', peinh=1, stprs=p, pvprs=round(p * 1.01, 2), salk3=round(p * 20, 2), waers=cur)
                self.add('mldoc', docref=f'{rnd.getrandbits(128):032X}', curtp='10', kalnr=kalnr, bdatj='2026', poper='009', categ='ZU', quant=10.0, meins='PC', stval=round(self.price.get((m, b), 10) * 10, 2), waers=cur)
        for setname, cls, members in [('A000-ALL', '0101', ['A000-ADM', 'A000-PRD']), ('A000-ADM', '0101', []), ('A000-PRD', '0101', [])]:
            self.add('setheader', setclass=cls, subclass='A000', setname=setname, settype='S' if not members else 'B', descript={'A000-ALL': 'All cost centers', 'A000-ADM': 'Administration', 'A000-PRD': 'Production'}[setname])
            for i, sub in enumerate(members, 1): self.add('setnode', setclass=cls, subclass='A000', setname=setname, lineid=f'{i:010d}', subsetname=sub)
        for i, (setname, kostl) in enumerate([('A000-ADM', '10101201'), ('A000-ADM', '17101201'), ('A000-PRD', '10101301'), ('A000-PRD', '41101301')], 1):
            self.add('setleaf', setclass='0101', subclass='A000', setname=setname, lineid=f'{i:010d}', valsign='I', valoption='EQ', valfrom=kostl, valto=kostl)
        # projects: one per company code with WBS elements
        for i, b in enumerate(self.co):
            pspnr = str(i * 10 + 1).zfill(8)
            pspid = f'P-{b}-001'
            self.add('proj', pspnr=pspnr, pspid=pspid, post1=f'{self.co[b]["ort01"]} plant expansion', vbukr=b, vkokr='A000', prctr='YB101', vernr='00000001', verna='Anna Becker',
                     plfaz='20260101', plsez='20271231', erdat='20251201', ernam='ANNA.BECKER', objnr=f'PD{pspnr}', werks=b, waers=self.co[b]['waers'])
            wbs = []
            for j, txt in enumerate(['Engineering', 'Procurement', 'Construction'], 1):
                w = str(i * 10 + j + 1).zfill(8)
                wbs.append(w)
                self.add('prps', pspnr=w, posid=f'{pspid}.{j}', post1=txt, psphi=pspnr, pbukr=b, pkokr='A000', prctr='YB101', fakkz='', plakz='X', belkz='X', stufe=2,
                         erdat='20251201', ernam='ANNA.BECKER', objnr=f'PR{w}', werks=b, astnr='')
            for j, w in enumerate(wbs):
                self.add('prhi', posnr=w, psphi=pspnr, up='00000000', down='00000000', left=wbs[j - 1] if j else '00000000', right=wbs[j + 1] if j + 1 < len(wbs) else '00000000')

    def cross_app(self):
        users = [('CB9980000010', 'Administrator', 'A'), ('CB9980000020', 'Batch User', 'B'), ('ANNA.BECKER', 'Anna Becker', 'A'), ('JOHN.MILLER', 'John Miller', 'A'),
                 ('PRIYA.SHARMA', 'Priya Sharma', 'A'), ('MARCO.ROSSI', 'Marco Rossi', 'A')]
        roles = {'Z_SALES_CLERK': ['VA01', 'VA02', 'VA03', 'VL01N', 'VF01'], 'Z_BUYER': ['ME21N', 'ME22N', 'ME23N', 'MIGO', 'MIRO'], 'Z_ACCOUNTANT': ['FB01', 'FB50', 'F-28', 'F110', 'FBL1N'],
                 'Z_PLANNER': ['CO01', 'CO02', 'CO11N', 'MD04'], 'Z_MAINTENANCE': ['IW21', 'IW31', 'IW41', 'IE03']}
        for i, (u, name, ty) in enumerate(users):
            self.add('usr02', bname=u, ustyp=ty, gltgv='20250101', gltgb='99991231', uflag=0, trdat=ymd(day(11, 3)), ltime='081500', **{'class': 'EMPLOYEES'})
            self.add('usr21', bname=u, persnumber=str(100 + i).zfill(10), addrnumber=str(200 + i).zfill(10), techdesc=name)
        for r, (agr, tcodes) in enumerate(roles.items()):
            for t in tcodes: self.add('agr_tcodes', agr_name=agr, type='TR', tcode=t)
            self.add('agr_1251', agr_name=agr, counter=1, object='S_TCODE', auth=f'{agr[:10]}00', field='TCD', low=tcodes[0], high=tcodes[-1])
            self.add('agr_users', agr_name=agr, uname=users[2 + r % 4][0], from_dat='20250101', to_dat='99991231', exclude='')
        # HR: org units, positions, employees
        for i, (otype, objid, stext) in enumerate([('O', '50000001', 'Sales Germany'), ('O', '50000002', 'Purchasing'), ('S', '50000101', 'Sales Manager'), ('S', '50000102', 'Buyer'), ('C', '50000201', 'Manager')]):
            self.add('hrp1000', plvar='01', otype=otype, objid=objid, istat='1', begda='20250101', endda='99991231', langu='E', seqnr=0, short=stext[:12], stext=stext)
        for i, (otype, objid, rsign, relat, sclas, sobid) in enumerate([('S', '50000101', 'A', '003', 'O', '50000001'), ('S', '50000102', 'A', '003', 'O', '50000002'), ('S', '50000101', 'B', '007', 'C', '50000201')]):
            self.add('hrp1001', otype=otype, objid=objid, plvar='01', rsign=rsign, relat=relat, istat='1', priox=0, begda='20250101', endda='99991231', varyf=f'{sclas}{sobid}', seqnr=0, sclas=sclas, sobid=sobid)
        emps = [('00001001', 'Anna', 'Becker', '1010', '50000001', '50000101', 6500.0), ('00001002', 'John', 'Miller', '1710', '50000002', '50000102', 7200.0), ('00001003', 'Priya', 'Sharma', '4110', '50000001', '50000101', 180000.0)]
        for pernr, first, last, b, orgeh, plans, pay in emps:
            for infty, extra in (('pa0000', dict(massn='01', massg='01', stat2='3')), ('pa0001', dict(bukrs=b, werks=b, persg='1', persk='DU', kostl=self.cc[b][0], orgeh=orgeh, plans=plans, stell='50000201')),
                                 ('pa0002', dict(nachn=last, vorna=first, gbdat='19880515', natio=self.co[b]['land1'], sprsl='E')), ('pa0008', dict(trfar='01', trfgb='01', trfgr='E10', bet01=pay, waers=self.co[b]['waers'], lga01='1000'))):
                self.add(infty, pernr=pernr, subty='', objps='', sprps='', endda='99991231', begda='20230101', seqnr=0, aedtm='20250101', uname='CB9980000010', **extra)
        # change documents for some sales orders, texts, attachments, application logs, jobs, number ranges, IDocs, workflow
        for r in self.out['vbak'][:5]:
            ch = self.num('changenr', 1)
            self.add('cdhdr', objectclas='VERKBELEG', objectid=r['vbeln'], changenr=ch, username=rnd.choice(self.users), udate=plus(r['erdat'], 1), utime='101010', tcode='VA02', change_ind='U')
            self.add('cdpos', objectclas='VERKBELEG', objectid=r['vbeln'], changenr=ch, tabname='VBAK', tabkey=f'100{r["vbeln"]}', fname='BSTNK', chngind='U', value_new=r['bstnk'], value_old='')
            self.add('stxh', tdobject='VBBK', tdname=r['vbeln'], tdid='0001', tdspras='E', tdtitle='Header note', tdfuser=r['ernam'], tdfdate=r['erdat'], tdltxtl=1)
            self.add('stxl', relid='TX', tdobject='VBBK', tdname=r['vbeln'], tdid='0001', tdspras='E', srtf2=0, clustr=40, clustd='Please deliver to the loading dock at the rear.')
        for i, r in enumerate(self.out['vbrk'][:4]):
            arc = f'{rnd.getrandbits(128):032X}'
            self.add('toa01', sap_object='VBRK', object_id=r['vbeln'], archiv_id='A1', arc_doc_id=arc, ar_object='SDOINVOICE', ar_date=r['fkdat'], reserve='PDF')
        for r in self.out['rbkp'][:3]:
            arc = f'{rnd.getrandbits(128):032X}'
            self.add('toa02', sap_object='BUS2081', object_id=f'{r["belnr"]}{r["gjahr"]}', archiv_id='A1', arc_doc_id=arc, ar_object='MMIFRINVOI', ar_date=r['budat'], reserve='PDF')
        self.add('toa03', sap_object='BKPF', object_id='10100000000012026', archiv_id='A1', arc_doc_id=f'{rnd.getrandbits(128):032X}', ar_object='FIIINVOICE', ar_date='20260301', reserve='TIF')
        self.add('toahr', sap_object='PREL', object_id='00001001', archiv_id='A1', arc_doc_id=f'{rnd.getrandbits(128):032X}', ar_object='HRICOLFOTO', ar_date='20230101', reserve='JPG')
        for i, r in enumerate(self.out['ekko'][:3]):
            objno = str(i + 1).zfill(12)
            self.add('sood', objtp='EXT', objyr='26', objno=objno, objdes=f'Offer {r["ebeln"]}', file_ext='PDF', objlen=34567, crdat=r['bedat'], ownnam=r['ernam'], objla='E')
            self.add('soffcont1', relid='L1', phio_id=f'{rnd.getrandbits(128):032X}', clustr=34567, clustd='%PDF-1.4 (demo content)')
            self.add('srgbtbrel', brelguid=f'{rnd.getrandbits(128):032X}', reltype='ATTA', instid_a=r['ebeln'], typeid_a='BUS2012', catid_a='BO', instid_b=f'FOLEXT26{objno}', typeid_b='MESSAGE', catid_b='BO', utctime=f'{r["bedat"]}100000')
        for i, (doknr, txt) in enumerate([('DOC-0001', 'Press drawing'), ('DOC-0002', 'Safety instruction')]):
            self.add('draw', dokar='DRW', doknr=doknr, dokvr='00', doktl='000', dktxt=txt, dokst='FR', dwnam='JOHN.MILLER', adatum='20250501', dokob='EQUI')
            self.add('drad', dokar='DRW', doknr=doknr, dokvr='00', doktl='000', dokob='EQUI', obzae=1, objky=self.out['equi'][i]['equnr'])
        for i, (obj, sub, txt) in enumerate([('BKPF', 'POSTING', 'Journal entries posted'), ('MATDOC', 'GOODSMVT', 'Goods movements posted'), ('ZHR', 'RAISE', 'Yearly raise run')]):
            self.add('balhdr', lognumber=str(i + 1).zfill(20), object=obj, subobject=sub, extnumber=txt, aldate='20261001', altime='020000', aluser='CB9980000020', altcode='SM37', msg_cnt_al=12 + i)
        for i, (job, prog) in enumerate([('SAP_REORG_JOBS', 'RSBTCDEL2'), ('Z_DAILY_BILLING', 'SDBILLDL'), ('Z_PAYMENT_RUN', 'SAPF110S')]):
            self.add('tbtco', jobname=job, jobcount=f'{10000001 + i}', sdlstrtdt='20261103', sdlstrttm='020000', strtdate='20261103', strttime='020000', enddate='20261103', endtime='020500',
                     status='F', sdluname='CB9980000020', reluname='CB9980000020', progname=prog)
        for obj, sub, nr, frm, to, cur in [('RV_BELEG', '', '01', '0000001000', '0009999999', 1016), ('RV_BELEG', '', '17', '0080000000', '0089999999', 80000012), ('RF_BELEG', '1010', '01', '0100000000', '0199999999', 100000010),
                                           ('EINKBELEG', '', '45', '4500000000', '4599999999', 4500000009), ('MATBELEG', '', '01', '4900000000', '4999999999', 4900000040)]:
            self.add('nriv', object=obj, subobject=sub, nrrangenr=nr, toyear='2026' if obj == 'RF_BELEG' else '0000', fromnumber=frm, tonumber=to, nrlevel=str(cur).zfill(10), externind='')
        for i, r in enumerate(self.out['vbrk'][:3]):
            docnum = str(i + 1).zfill(16)
            self.add('edidc', docnum=docnum, status='03', direct='1', mestyp='INVOIC', idoctp='INVOIC02', rcvprn=r['kunag'], rcvprt='KU', sndprn='S4HCLNT100', credat=r['fkdat'], cretim='071600', upddat=r['fkdat'])
            for s, txt in [('E1EDK01', 'header'), ('E1EDP01', 'item')]:
                self.add('edid4', docnum=docnum, counter=0, segnum=1 if s == 'E1EDK01' else 2, segnam=s, sdata=f'{txt} {r["vbeln"]} {r["netwr"]} {r["waerk"]}')
            for c, (stat, txt) in enumerate([('01', 'IDoc generated'), ('30', 'IDoc ready for dispatch'), ('03', 'Data passed to port OK')], 1):
                self.add('edids', docnum=docnum, logdat=r['fkdat'], logtim=f'0716{c:02d}', countr=c, status=stat, statxt=txt, uname='CB9980000020')
        for i, r in enumerate(self.out['eban'][:4]):
            wi = str(i + 1).zfill(12)
            self.add('swwwihead', wi_id=wi, wi_type='W', wi_stat='COMPLETED' if i < 2 else 'READY', wi_text=f'Release purchase requisition {r["banfn"]}', wi_cd=r['badat'], wi_ct='090000',
                     wi_creator=r.get('afnam') or 'ANNA.BECKER', wi_rh_task='WS00000038', wi_prio=5)
            self.add('sww_contob', wi_id=wi, element='_WI_OBJECT_ID', tab_index=0, objtype='BUS2105', objkey=f'{r["banfn"]}{r["bnfpo"]}')
        # classification: a class with characteristics, values per batch
        self.add('klah', clint='0000000001', klart='023', **{'class': 'RAW_MATERIAL'}, vondt='20250101', bisdt='99991231', statu='1')
        for i, (atnam, fmt) in enumerate([('PURITY', 'NUM'), ('COLOR', 'CHAR')], 1):
            atinn = str(i).zfill(10)
            self.add('cabn', atinn=atinn, adzhl=0, atnam=atnam, atfor=fmt, anzst=10, anzdz=2 if fmt == 'NUM' else 0, atkle='X')
            for v, txt in enumerate(['99.5', '98.0'] if fmt == 'NUM' else ['WHITE', 'GREY'], 1): self.add('cawn', atinn=atinn, atzhl=v, adzhl=0, atwrt=txt, atflv=float(txt) if fmt == 'NUM' else 0.0)
        for i, r in enumerate(self.out['mch1'][:4]):
            cuobj = str(i + 1).zfill(18)
            objek = f'{r["matnr"]:<40}{r["charg"]}'
            self.add('inob', cuobj=cuobj, klart='023', obtab='MCH1', objek=objek)
            self.add('kssk', objek=cuobj, mafid='O', klart='023', clint='0000000001', adzhl=0, zaehl=1, statu='1')
            self.add('ausp', objek=cuobj, atinn='0000000001', atzhl=1, mafid='O', klart='023', adzhl=0, atwrt='', atflv=99.5 - i * 0.5)
            self.add('ausp', objek=cuobj, atinn='0000000002', atzhl=1, mafid='O', klart='023', adzhl=0, atwrt='WHITE' if i % 2 == 0 else 'GREY', atflv=0.0)

    def additions_2025(self):
        """The tables of the second set of documents: maintenance operations, networks, CO line items and budgets, partners
        and status history of orders and notifications, HR infotypes, EWM warehouses and TM freight orders for the deliveries."""
        guid = lambda: f'{rnd.getrandbits(128):032X}'
        crhd = {r['werks']: r['objid'] for r in reversed(self.out['crhd'])}
        # maintenance order operations
        for a in [r for r in self.out['aufk'] if r['autyp'] == '30']:
            aufpl = self.num('aufpl_pm', 3000001, 10)
            for j, txt in enumerate(['Isolate and inspect', 'Replace part', 'Test run'], 1):
                self.add('afvc', aufpl=aufpl, aplzl=j, vornr=f'{j * 10:04d}', arbid='10000003', steus='PM01', ltxa1=txt, werks=a['werks'], objnr=f'OV{aufpl}{j:08d}',
                         rueck=self.num('rueck', 1, 10), rmzhl=0, aufnr=a['aufnr'])
            for c, (parvw, parnr) in enumerate([('VW', '00001002'), ('AB', '50000002')], 1):
                self.add('ihpa', objnr=a['objnr'], parvw=parvw, counter=c, parnr=parnr, erdat=a['erdat'], ernam=a['ernam'])
        for q in self.out['qmel']:
            self.add('ihpa', objnr=q['objnr'], parvw='VU' if q['qmart'] != 'Q1' else 'LF', counter=1, parnr='JOHN.MILLER' if q['qmart'] != 'Q1' else q['lifnum'], erdat=q['erdat'], ernam=q['ernam'])
        # networks with activities, budgets per WBS element, project status
        for i, p in enumerate(self.out['proj']):
            b = p['vbukr']
            wbs = [w for w in self.out['prps'] if w['psphi'] == p['pspnr']]
            aufnr = self.num('aufnr_nw', 900001, 12)
            self.add('aufk', aufnr=aufnr, autyp='20', auart='PS02', ktext=p['post1'], bukrs=b, werks=b, kokrs='A000', kostv='', prctr='YB101', erdat=p['erdat'],
                     ernam='ANNA.BECKER', objnr=f'NP{aufnr}', waers=p['waers'], pspel=wbs[0]['pspnr'])
            aufpl = self.num('aufpl_nw', 5000001, 10)
            for j, w in enumerate(wbs, 1):
                self.add('afvc', aufpl=aufpl, aplzl=j, vornr=f'{j * 10:04d}', arbid=crhd.get(b, ''), steus='PS01', ltxa1=f'{w["post1"]} work', werks=b, objnr=f'NV{aufpl}{j:08d}',
                         rueck=self.num('rueck', 1, 10), rmzhl=0, aufnr=aufnr, projn=w['pspnr'])
            for objnr, obtyp, stats in [(p['objnr'], 'PDN', ['I0002']), (f'NP{aufnr}', 'NPH', ['I0002'])] + [(w['objnr'], 'PRN', ['I0002'] if k < 2 else ['I0001']) for k, w in enumerate(wbs)]:
                self.add('jsto', objnr=objnr, obtyp=obtyp, stsma='')
                for s in stats: self.add('jest', objnr=objnr, stat=s, inact='', chgnr='001')
            for k, w in enumerate(wbs):
                total = [250000.0, 400000.0, 900000.0][k] * (83.4 if b == '4110' else 1)
                self.add('bpge', lednr='0001', objnr=w['objnr'], trgkz='B', wrttp='41', geber='', versn='000', vorga='KBUD', twaer=p['waers'], wtges=total, wlges=total)
                for y, share in (('2026', 0.6), ('2027', 0.4)):
                    self.add('bpja', lednr='0001', objnr=w['objnr'], trgkz='B', wrttp='41', gjahr=y, geber='', versn='000', vorga='KBUD', twaer=p['waers'], wtjhr=round(total * share, 2), wljhr=round(total * share, 2))
        # status history of every status set so far
        for r in self.out['jest']:
            self.add('jcds', objnr=r['objnr'], stat=r['stat'], chgnr=r['chgnr'], udate='20260801' if r['objnr'][:2] in ('OR', 'QM') else '20260115', utime='091500',
                     usnam='JOHN.MILLER' if r['objnr'][:2] in ('OR', 'QM') else 'ANNA.BECKER', inact='', cdtcode='IW32' if r['objnr'][:2] == 'OR' else 'CJ20N')
        # CO line items: the cost center lines of the universal journal and internal repostings
        for r in self.out['acdoca']:
            if r['rldnr'] != '0L' or not r['rcntr']: continue
            self.add('coep', kokrs='A000', belnr=self.num('coep', 200000001), buzei=1, gjahr=r['gjahr'], perio=r['poper'], objnr=f'KSA000{r["rcntr"]}', kstar=r['racct'], wrttp='04',
                     versn='000', vrgng='COIN', wkgbtr=r['hsl'], wtgbtr=r['tsl'], twaer=r['rtcur'], owaer=r['rhcur'], bukrs=r['rbukrs'], budat=r['budat'], refbn=r['belnr'], awtyp='BKPF',
                     beltp=1, sgtxt=r['sgtxt'])
        for b, c in zip(self.co, self.out['cobk']):
            ccs = self.cc[b]
            for n, (kostl, sign) in enumerate([(ccs[0], -1), (ccs[1 % len(ccs)], 1)], 1):
                self.add('coep', kokrs='A000', belnr=c['belnr'], buzei=n, gjahr='2026', perio='006', objnr=f'KSA000{kostl}', kstar='0065300000', wrttp='04', versn='000', vrgng='RKU1',
                         wkgbtr=sign * 500.0, wtgbtr=sign * 500.0, twaer=self.co[b]['waers'], owaer=self.co[b]['waers'], bukrs=b, budat=c['budat'], awtyp='COBK', beltp=1, sgtxt=c['bltxt'])
        texts = {r['saknr']: r for r in self.D['skat']}
        for a in self.D['ska1']:
            if a['gvtyp'] == 'X' and a['saknr'] in texts:
                self.add('csku', spras='E', ktopl='YCOA', kstar=a['saknr'], ktext=texts[a['saknr']]['txt20'], ltext=texts[a['saknr']]['txt50'])
        for r in self.out['crhd']:
            self.add('crca', objty=r['objty'], objid=r['objid'], canum=1, kapid=r['kapid'], fork1='SAP006', fork2='SAP008')
        for r in self.out['afvc']:
            self.add('afvu', aufpl=r['aufpl'], aplzl=r['aplzl'], usr00='Shift A' if int(r['aplzl']) % 2 else 'Shift B', usr01=r['ltxa1'][:20], usr04=float(2 + int(r['aplzl'])), use04='H', usr08='20260815')
        # HR: personnel areas, org unit texts, addresses, working time, communication
        for b, c in self.co.items():
            self.add('t500p', persa=b, name1=f'{c["ort01"]} site', bukrs=b, land1=c['land1'], ort01=c['ort01'])
        for r in self.out['hrp1000']:
            if r['otype'] == 'O': self.add('t527x', sprsl='E', orgeh=r['objid'], endda='99991231', begda=r['begda'], orgtx=r['stext'])
        addr = {'1010': ('Hafenstrasse 12', 'Hamburg', '20457', 'DE', '02'), '1710': ('500 Oak Avenue', 'Palo Alto', '94301', 'US', 'CA'), '4110': ('14 MG Road', 'Bangalore', '560001', 'IN', '10')}
        for r in self.out['pa0001']:
            first = next(x for x in self.out['pa0002'] if x['pernr'] == r['pernr'])
            stras, ort, pstlz, land, regio = addr[r['bukrs']]
            hdr = dict(pernr=r['pernr'], objps='', sprps='', endda='99991231', begda='20230101', seqnr=0, aedtm='20250101', uname='CB9980000010')
            self.add('pa0006', **hdr, subty='1', anssa='1', stras=stras, ort01=ort, pstlz=pstlz, land1=land, regio=regio)
            self.add('pa0007', **hdr, subty='', schkz='NORM', wostd=40.0, empct=100.0, teilk='')
            user = f'{first["vorna"]}.{first["nachn"]}'.upper()
            self.add('pa0105', **hdr, subty='0001', usrid=user, usrid_long='')
            self.add('pa0105', **hdr, subty='0010', usrid='', usrid_long=f'{user.lower()}@example.com')
        # EWM: a warehouse per plant with bins and stock, handling units and warehouse tasks for the deliveries
        for b, plant in self.plants.items():
            dlvs = [r for r in self.out['likp'] if r['vstel'] == b]
            if not dlvs: continue
            lgnum = b
            self.add('/scwm/t300', lgnum=lgnum, lnumt=f'Warehouse {plant.get("name1", b)}'[:40], werks=b, lgort=self.slocs.get(b, ['0001'])[0])
            bins = []
            for typ_, n in (('0010', 6), ('0020', 4)):
                for j in range(1, n + 1):
                    lgpla = f'{typ_}-{(j + 1) // 2:02d}-{j:02d}-A'
                    bins.append(lgpla)
                    self.add('/scwm/lagp', lgnum=lgnum, lgpla=lgpla, lgtyp=typ_, lgber='0001', lptyp='E1' if typ_ == '0010' else 'P1', aisle=f'{(j + 1) // 2:02d}', stack=f'{j:02d}', lvl_v='A',
                             kzler='', max_weight=1000.0, skzue='')
            for typ_, lgpla in (('9010', 'GR-ZONE'), ('9020', 'GI-ZONE')):
                self.add('/scwm/lagp', lgnum=lgnum, lgpla=lgpla, lgtyp=typ_, lgber='0001', lptyp='Z1', kzler='', max_weight=99999.0)
            items = [r for r in self.out['lips'] if r['vbeln'] in {d['vbeln'] for d in dlvs}]
            home = {}
            for j, m in enumerate(sorted({r['matnr'] for r in items})):
                home[m] = bins[j % len(bins)]
                self.add('/scwm/quan', lgnum=lgnum, guid_stock=guid(), lgpla=home[m], matnr=m, charg='', cat='F1', quan=float(200 + 25 * j), unit='PC', owner=b, entitled=b,
                         huident='', wdatu='20260601')
            for d in dlvs:
                done = bool(d['wadat_ist'])
                docid, who = guid(), self.num(f'who_{b}', 1, 10)
                docno = f'3{d["vbeln"][-9:]}'
                self.add('/scwm/prdo', docid=docid, lgnum=lgnum, docno=docno, doctype='OUTB', refdocno_erp=d['vbeln'], partyno_st=d['kunnr'], status_gi='9' if done else '1',
                         status_pick='9' if done else '1', created_at=d['erdat'])
                self.add('/scwm/who', lgnum=lgnum, who=who, queue='OUTB-PICK', areawho='0010', rsrc='RF-USER-1' if done else '', status='C' if done else '', wcr='PICK', created_at=d['erdat'], lsd=d['wadat'])
                hu = guid()
                self.add('/scwm/huhdr', guid_hu=hu, lgnum=lgnum, huident=f'1{self.num("huident", 1, 19)}', pmat='EWMS4-PAL00', lgpla='GI-ZONE' if done else '', hustat='CLOS' if done else 'OPEN',
                         g_weight=float(d['btgew'] or 0), unit_gw=d['gewei'] or 'KG', created_at=d['erdat'])
                for t, it in enumerate([r for r in items if r['vbeln'] == d['vbeln']], 1):
                    task = dict(lgnum=lgnum, tanum=self.num(f'tanum_{b}', 1, 12), tapos=1, who=who, procty='2010', matnr=it['matnr'], charg=it['charg'], meins=it['vrkme'] or 'PC',
                                vlpla=home[it['matnr']], nlpla='GI-ZONE', rdoccat='PDO', rdocno=docno)
                    if done: self.add('/scwm/ordim_c', **task, tostat='C', vsola=float(it['lfimg']), confirmed_at=d['wadat_ist'], confirmed_by='JOHN.MILLER')
                    else: self.add('/scwm/ordim_o', **task, tostat='', vsolm=float(it['lfimg']), vlenr='', created_at=d['erdat'])
                    self.add('/scwm/huitm', guid_parent=hu, guid_stock=guid(), matnr=it['matnr'], charg=it['charg'], quan=float(it['lfimg']), unit=it['vrkme'] or 'PC', cat='F1')
            for po in [r for r in self.out['ekko'] if r['bukrs'] == self.plants[b].get('bwkey', b)][:3]:
                gr = any(m['ebeln'] == po['ebeln'] and m['bwart'] == '101' for m in self.out['matdoc'])
                self.add('/scwm/prdi', docid=guid(), lgnum=lgnum, docno=f'1{po["ebeln"][-9:]}', doctype='INB', refdocno_erp=po['ebeln'], partyno_sf=po['lifnr'], status_gr='9' if gr else '1', created_at=po['bedat'])
            # TM: a transportation requirement per delivery, a freight order per two deliveries with items, stops and charges
            carrier = self.supp.get(b, [''])[-1]
            for d in dlvs:
                self.add('/scmtms/d_trqrot', db_key=guid(), trq_id=self.num('trq', 1, 20), trq_type='OTR1', trq_cat='03', base_btd_id=d['vbeln'], base_btd_tco='73', lifecycle='02', created_on=d['erdat'])
            for g in range(0, len(dlvs), 2):
                group = dlvs[g:g + 2]
                done = all(x['wadat_ist'] for x in group)
                fo = guid()
                self.add('/scmtms/d_torrot', db_key=fo, tor_id=self.num('tor', 6100000001, 20), tor_type='ZFO1', tor_cat='TO', lifecycle='05' if done else '02', execution='07' if done else '02',
                         tspid=carrier, mtr='01', purch_org_id=b, labeltxt=f'Road freight {b} {group[0]["wadat"]}', created_on=group[0]['erdat'], created_by='JOHN.MILLER')
                weight = 0.0
                for d in group:
                    for it in [r for r in items if r['vbeln'] == d['vbeln']]:
                        w = float(it['lfimg']) * 2.5
                        weight += w
                        self.add('/scmtms/d_torite', db_key=guid(), parent_key=fo, item_id=f'{int(self.num(f"tori_{fo}", 1, 6)) * 10:010d}', item_cat='PRD', product_id=it['matnr'], qua_pcs_val=float(it['lfimg']),
                                 qua_pcs_uni=it['vrkme'] or 'PC', gro_wei_val=w, gro_wei_uni='KG', base_btd_id=d['vbeln'], base_btditem_id=it['posnr'])
                stops = [('O', f'SP_{b}', group[0]['wadat'])] + [('I', f'BP_{d["kunnr"]}', plus(d['wadat'], 2)) for d in group]
                for s, (cat, loc, when) in enumerate(stops, 1):
                    self.add('/scmtms/d_torstp', db_key=guid(), parent_key=fo, stop_id=f'{s * 10:010d}', stop_cat=cat, log_locid=loc, plan_trans_time=when, acc_start=when if done else '')
                self.add('/scmtms/d_tccrot', db_key=guid(), host_key=fo, net_amount=round(180 + weight * 0.12, 2), doc_currency=self.co[b]['waers'] if b in self.co else 'EUR',
                         calc_status='01', calc_date=group[0]['erdat'])

    # -------------------------------------------------------------- every other table: a few plausible rows
    def fill_rest(self):
        pools = {'MATNR': list(self.mara), 'WERKS': list(self.plants), 'BUKRS': list(self.co), 'KUNNR': [k for v in self.cust.values() for k in v],
                 'LIFNR': [k for v in self.supp.values() for k in v], 'KOSTL': [k for v in self.cc.values() for k in v], 'PRCTR': ['YB101', 'YB102', 'YB103', 'YB900'],
                 'KOKRS': ['A000'], 'EKORG': list(self.co), 'VKORG': list(self.co), 'VTWEG': ['10', '20'], 'SPART': ['00'], 'EKGRP': ['001', '002', '003'], 'SPRAS': ['E'],
                 'LANGU': ['E'], 'MEINS': ['PC'], 'WAERS': ['EUR', 'USD', 'INR'], 'LAND1': ['DE', 'US', 'IN'], 'GJAHR': ['2026'], 'ERNAM': self.users, 'USNAM': self.users,
                 'UNAME': self.users, 'SAKNR': ['0012100000', '0041000000', '0050000100'], 'HKONT': ['0012100000', '0041000000'], 'KTOPL': ['YCOA'], 'PARTNER': [p['partner'] for p in self.D['but000']]}
        for t, (label, cols) in self.T.items():
            if t in self.D or t in self.out: continue
            cols = [c for c in cols if c[0] != 'mandt']
            keys = [c for c in cols if c[2]]
            seen = set()
            for i in range(4):
                row = {}
                for name, ty, key, ref in cols:
                    N = name.upper()
                    if N in pools: v = pools[N][i % len(pools[N])]
                    elif ty == 'abap.dats': v = ymd(day(1 + (i * 3) % 12, 1 + i * 5))
                    elif ty == 'abap.tims': v = f'{8 + i:02d}0000'
                    elif ty in ('abap.cuky',): v = ['EUR', 'USD', 'INR'][i % 3]
                    elif ty.startswith('abap.unit'): v = 'PC'
                    elif ty == 'abap.lang': v = 'E'
                    elif ty.startswith(('abap.curr', 'abap.dec')): v = round(rnd.uniform(10, 5000), 2)
                    elif ty.startswith('abap.quan'): v = float(rnd.randint(1, 100))
                    elif ty.startswith('abap.int'): v = rnd.randint(1, 50)
                    elif ty.startswith('abap.numc'): v = str(i + 1)
                    else:
                        n_ = int(re.search(r'\d+', ty).group()) if re.search(r'\d+', ty) else 10
                        v = ('X' if i % 2 == 0 else '') if n_ == 1 else f'{N[:min(n_ - 2, 8)]}{i + 1}' if n_ > 3 else f'{i + 1}'.zfill(n_)
                    row[name] = v
                kv = tuple(row[c[0]] for c in keys)
                if kv in seen: continue
                seen.add(kv)
                self.add(t, **row)
