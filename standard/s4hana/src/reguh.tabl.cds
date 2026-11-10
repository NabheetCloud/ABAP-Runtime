@EndUserText.label : 'Payment run header data'
define table reguh {
  key mandt : abap.clnt not null;
  key laufd : abap.dats not null;
  key laufi : abap.char(6) not null;
  key xvorl : abap.char(1) not null;
  key zbukr : abap.char(4) not null;
  key lifnr : abap.char(10) not null;
  key kunnr : abap.char(10) not null;
  key empfg : abap.char(16) not null;
  key vblnr : abap.char(10) not null;
  @Semantics.amount.currencyCode : 'reguh.waers'
  rwbtr     : abap.curr(15,2);
  waers     : abap.cuky;
  zaldt     : abap.dats;
  rzawe     : abap.char(1);
  hbkid     : abap.char(5);
  hktid     : abap.char(5);
  name1     : abap.char(35);
  @Semantics.amount.currencyCode : 'reguh.waers'
  rbetr     : abap.curr(15,2);
  valut     : abap.dats;
}
