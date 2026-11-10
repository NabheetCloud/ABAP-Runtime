@EndUserText.label : 'Sales areas'
define table tvta {
  key mandt  : abap.clnt not null;
  key vkorg  : abap.char(4) not null;
  key vtweg  : abap.char(2) not null;
  key spart  : abap.char(2) not null;
  vkorgv     : abap.char(20);
  vtwegv     : abap.char(20);
  spartv     : abap.char(20);
}
