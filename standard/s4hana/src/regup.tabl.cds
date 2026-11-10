@EndUserText.label : 'Payment run items'
define table regup {
  key mandt : abap.clnt not null;
  key laufd : abap.dats not null;
  key laufi : abap.char(6) not null;
  key xvorl : abap.char(1) not null;
  key zbukr : abap.char(4) not null;
  key lifnr : abap.char(10) not null;
  key kunnr : abap.char(10) not null;
  key empfg : abap.char(16) not null;
  key vblnr : abap.char(10) not null;
  key bukrs : abap.char(4) not null;
  key belnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  key buzei : abap.numc(3) not null;
  dmbtr     : abap.dec(15,2);
  wrbtr     : abap.dec(15,2);
  blart     : abap.char(2);
  shkzg     : abap.char(1);
  xblnr     : abap.char(16);
}
