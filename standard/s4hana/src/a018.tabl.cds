@EndUserText.label : 'Supplier/material info record conditions (access)'
define table a018 {
  key mandt : abap.clnt not null;
  key kappl : abap.char(2) not null;
  key kschl : abap.char(4) not null;
  key lifnr : abap.char(10) not null;
  key matnr : abap.char(40) not null;
  key ekorg : abap.char(4) not null;
  key esokz : abap.char(1) not null;
  key datbi : abap.dats not null;
  datab     : abap.dats;
  knumh     : abap.char(10);
}
