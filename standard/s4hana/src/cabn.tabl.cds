@EndUserText.label : 'Characteristic'
define table cabn {
  key mandt : abap.clnt not null;
  key atinn : abap.char(10) not null;
  key adzhl : abap.numc(4) not null;
  atnam     : abap.char(30);
  atfor     : abap.char(4);
  anzst     : abap.int4;
  anzdz     : abap.int4;
  atkle     : abap.char(20);
}
