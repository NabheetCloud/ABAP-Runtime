@EndUserText.label : 'Characteristic values of object'
define table ausp {
  key mandt : abap.clnt not null;
  key objek : abap.char(50) not null;
  key atinn : abap.char(10) not null;
  key atzhl : abap.numc(4) not null;
  key mafid : abap.char(1) not null;
  key klart : abap.char(3) not null;
  key adzhl : abap.numc(4) not null;
  atwrt     : abap.char(30);
  atflv     : abap.dec(15,3);
  atflb     : abap.char(20);
}
