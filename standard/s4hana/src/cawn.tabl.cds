@EndUserText.label : 'Characteristic values'
define table cawn {
  key mandt : abap.clnt not null;
  key atinn : abap.char(10) not null;
  key atzhl : abap.numc(4) not null;
  key adzhl : abap.numc(4) not null;
  atwrt     : abap.char(30);
  atflv     : abap.dec(15,3);
}
