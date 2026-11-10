@EndUserText.label : 'Class header'
define table klah {
  key mandt : abap.clnt not null;
  key clint : abap.char(10) not null;
  klart     : abap.char(3);
  class     : abap.char(18);
  bisdt     : abap.dats;
  statu     : abap.char(1);
  vondt     : abap.dats;
}
