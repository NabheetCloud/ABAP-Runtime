@EndUserText.label : 'Condition quantity scales'
define table konm {
  key mandt : abap.clnt not null;
  key knumh : abap.char(10) not null;
  key kopos : abap.numc(2) not null;
  key klfn1 : abap.numc(4) not null;
  kstbm     : abap.dec(13,3);
  kstbw     : abap.dec(15,3);
  kbetr     : abap.dec(15,3);
}
