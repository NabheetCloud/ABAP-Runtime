@EndUserText.label : 'Storage location stock history'
define table mardh {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key lgort : abap.char(4) not null;
  key lfgja : abap.numc(4) not null;
  key lfmon : abap.numc(2) not null;
  insme     : abap.dec(13,3);
  labst     : abap.dec(13,3);
  speme     : abap.dec(13,3);
}
