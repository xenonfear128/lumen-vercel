import { parseFile } from 'music-metadata';
export async function metadata(path) {
 const {common,format}=await parseFile(path,{duration:true});
 const picture=common.picture?.find(p=>p.data.length<2000000);
 return {title:common.title||null,artist:common.artist||null,album:common.album||null,year:common.year||null,genre:common.genre?.join(', ')||null,duration:format.duration||null,codec:format.codec||null,bitrate:format.bitrate||null,sampleRate:format.sampleRate||null,coverUrl:picture?`data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`:null,metaLoaded:true};
}
