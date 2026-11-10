@EndUserText.label : 'Contract data'
define table veda {
  key mandt   : abap.clnt not null;
  key vbeln   : abap.char(10) not null;
  key vposn   : abap.numc(6) not null;
  vbegdat     : abap.dats;
  venddat     : abap.dats;
  vkuesch     : abap.char(20);
  vlaufz      : abap.int4;
}
