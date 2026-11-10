@EndUserText.label : 'Sample results (single values)'
define table qase {
  key mandt     : abap.clnt not null;
  key prueflos  : abap.char(12) not null;
  key vorglfnr  : abap.numc(8) not null;
  key merknr    : abap.numc(4) not null;
  key detailerg : abap.numc(6) not null;
  messwert      : abap.dec(15,3);
  mbewertg      : abap.char(20);
}
