@EndUserText.label : 'EANs/GTINs per unit'
define table mean {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key meinh : abap.unit(3) not null;
  key lfnum : abap.char(20) not null;
  ean11     : abap.char(20);
  eantp     : abap.char(20);
  hpean     : abap.char(20);
}
