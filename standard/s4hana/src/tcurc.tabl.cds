@EndUserText.label : 'Currencies'
define table tcurc {
  key mandt    : abap.clnt not null;
  key waers    : abap.cuky not null;
  isocd        : abap.char(3);
  altwr        : abap.numc(3);
  xprimary     : abap.char(1);
}
