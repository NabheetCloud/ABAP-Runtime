@EndUserText.label : 'Project definition'
define table proj {
  key mandt : abap.clnt not null;
  key pspnr : abap.char(8) not null;
  pspid     : abap.char(24);
  vbukr     : abap.char(20);
  objnr     : abap.char(22);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  plfaz     : abap.dats;
  plsez     : abap.dats;
  post1     : abap.char(40);
  prctr     : abap.char(10);
  verna     : abap.char(20);
  vernr     : abap.char(20);
  vkokr     : abap.char(20);
  waers     : abap.cuky;
  werks     : abap.char(4);
}
