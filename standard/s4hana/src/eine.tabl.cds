@EndUserText.label : 'Info record purchasing org'
define table eine {
  key mandt : abap.clnt not null;
  key infnr : abap.char(10) not null;
  key ekorg : abap.char(4) not null;
  key esokz : abap.char(1) not null;
  key werks : abap.char(4) not null;
  @Semantics.amount.currencyCode : 'eine.waers'
  netpr     : abap.curr(15,2);
  peinh     : abap.dec(15,3);
  aplfz     : abap.dec(15,3);
  norbm     : abap.dec(13,3);
  minbm     : abap.dec(13,3);
  waers     : abap.cuky;
  bprme     : abap.unit(3);
  ekgrp     : abap.char(3);
  mwskz     : abap.char(2);
}
