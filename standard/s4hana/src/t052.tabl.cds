@EndUserText.label : 'Terms of payment'
define table t052 {
  key mandt : abap.clnt not null;
  key zterm : abap.char(4) not null;
  ztag1     : abap.numc(3);
  zprz1     : abap.dec(5,3);
  ztag2     : abap.numc(3);
  zprz2     : abap.dec(5,3);
  ztag3     : abap.numc(3);
}
