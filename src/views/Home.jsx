import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';
import PublicHeader from "../layout/PublicHeader";

export default function Home() {
    return (
        <div className=' w-full bg-cover h-full black-fg'>
            <PublicHeader/>
            <div className='flex px-7 py-5 px-[200px] pt-[225px]'>
                <div className='px-[200px]'>
                    <div className="pb-10">
                        <p className="text-lg font-bold">
                            What's so good about us?
                        </p>
                    </div>
                    <p>
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec a justo non tortor luctus dignissim. Curabitur ultrices risus et leo ornare bibendum. Mauris ligula odio, suscipit id orci non, imperdiet cursus tortor. Vivamus ut laoreet nunc. Pellentesque vehicula viverra mattis. Suspendisse commodo leo libero, in tempus magna luctus vel. Mauris sed rutrum velit. Vivamus lacinia posuere lacus, sit amet scelerisque nisi imperdiet vel. Nunc gravida, ante et ultrices rhoncus, orci eros porta odio, ut sodales justo urna sed elit. Praesent cursus velit diam, eu pharetra urna rhoncus sed. Donec cursus lorem ut purus hendrerit, non egestas arcu auctor. Cras eu elit quis justo convallis ultrices. Duis non finibus tortor. Donec et tincidunt ipsum. Aenean ut mi neque.
                    </p>
                    <p>
                        Aenean vehicula sapien a augue porttitor hendrerit. Suspendisse vitae ligula sodales, dignissim erat vel, elementum enim. Vestibulum vitae lectus porttitor, placerat turpis id, dapibus ipsum. Curabitur in sapien ut sem vehicula hendrerit rutrum ac nunc. Sed mollis auctor turpis varius imperdiet. Nulla lacus ex, consectetur ut lacus quis, lobortis lobortis velit. Mauris eu laoreet mauris. Nam dapibus, elit bibendum dignissim placerat, libero urna consequat sem, at imperdiet neque mauris ac augue. Quisque massa nisi, ullamcorper eget felis vitae, egestas varius sapien. Morbi vehicula maximus leo id interdum. Fusce in eros eget velit malesuada blandit sed at magna. Ut rhoncus ipsum urna, a ullamcorper justo volutpat at. Suspendisse posuere nulla at nulla tristique, id interdum enim vulputate. Suspendisse vel sem non erat feugiat convallis. Suspendisse congue tortor sit amet enim lobortis rutrum.
                    </p>
                    <p>
                        Praesent rutrum feugiat magna, ut eleifend mauris scelerisque a. Fusce non mollis lectus. Aenean auctor nulla id eros ullamcorper, non vehicula justo tincidunt. Morbi euismod urna sed neque euismod, efficitur lobortis neque consequat. Ut rhoncus vestibulum sagittis. Quisque a mi sit amet lacus volutpat suscipit. Praesent malesuada nibh vitae dolor porttitor, id fringilla turpis maximus. Maecenas eget sapien odio.
                    </p>
                    <p>
                        Nullam dictum urna in urna vulputate convallis. Curabitur pellentesque molestie felis a cursus. In hac habitasse platea dictumst. Fusce scelerisque mollis elit vitae lacinia. Etiam iaculis sem dolor, non accumsan eros malesuada ac. Quisque imperdiet commodo enim, lacinia ultrices ante suscipit et. Nunc accumsan sagittis magna, non auctor ex iaculis quis. Donec dapibus purus vitae turpis lobortis condimentum. Phasellus viverra diam at neque facilisis consequat. Phasellus ut interdum nisi. Duis sed ante sed augue condimentum tincidunt.
                    </p>
                    <p>
                        Integer vestibulum erat non mollis tincidunt. Aliquam suscipit tincidunt ante sit amet tristique. Vestibulum non eros ullamcorper, gravida tellus in, vestibulum tortor. Donec dignissim augue nisi, vitae blandit orci lobortis ac. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Quisque ligula mi, congue in lectus a, molestie finibus lorem. Donec vel est urna. Praesent malesuada mauris eu ex tincidunt commodo. Vivamus arcu enim, luctus eu porttitor sit amet, posuere sit amet arcu. Aliquam et lacus felis. Sed egestas pellentesque iaculis. Ut in posuere massa, vitae pellentesque tortor.
                    </p>
                </div>
                
            </div>
            <div className='flex px-7 py-5 px-[200px]'>
                <div className='px-[200px]'>
                    <div className="pb-10">
                        <p className="text-lg font-bold">
                            What's so good about us?
                        </p>
                    </div>
                    <p>
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec a justo non tortor luctus dignissim. Curabitur ultrices risus et leo ornare bibendum. Mauris ligula odio, suscipit id orci non, imperdiet cursus tortor. Vivamus ut laoreet nunc. Pellentesque vehicula viverra mattis. Suspendisse commodo leo libero, in tempus magna luctus vel. Mauris sed rutrum velit. Vivamus lacinia posuere lacus, sit amet scelerisque nisi imperdiet vel. Nunc gravida, ante et ultrices rhoncus, orci eros porta odio, ut sodales justo urna sed elit. Praesent cursus velit diam, eu pharetra urna rhoncus sed. Donec cursus lorem ut purus hendrerit, non egestas arcu auctor. Cras eu elit quis justo convallis ultrices. Duis non finibus tortor. Donec et tincidunt ipsum. Aenean ut mi neque.
                    </p>
                    <p>
                        Aenean vehicula sapien a augue porttitor hendrerit. Suspendisse vitae ligula sodales, dignissim erat vel, elementum enim. Vestibulum vitae lectus porttitor, placerat turpis id, dapibus ipsum. Curabitur in sapien ut sem vehicula hendrerit rutrum ac nunc. Sed mollis auctor turpis varius imperdiet. Nulla lacus ex, consectetur ut lacus quis, lobortis lobortis velit. Mauris eu laoreet mauris. Nam dapibus, elit bibendum dignissim placerat, libero urna consequat sem, at imperdiet neque mauris ac augue. Quisque massa nisi, ullamcorper eget felis vitae, egestas varius sapien. Morbi vehicula maximus leo id interdum. Fusce in eros eget velit malesuada blandit sed at magna. Ut rhoncus ipsum urna, a ullamcorper justo volutpat at. Suspendisse posuere nulla at nulla tristique, id interdum enim vulputate. Suspendisse vel sem non erat feugiat convallis. Suspendisse congue tortor sit amet enim lobortis rutrum.
                    </p>
                    <p>
                        Praesent rutrum feugiat magna, ut eleifend mauris scelerisque a. Fusce non mollis lectus. Aenean auctor nulla id eros ullamcorper, non vehicula justo tincidunt. Morbi euismod urna sed neque euismod, efficitur lobortis neque consequat. Ut rhoncus vestibulum sagittis. Quisque a mi sit amet lacus volutpat suscipit. Praesent malesuada nibh vitae dolor porttitor, id fringilla turpis maximus. Maecenas eget sapien odio.
                    </p>
                    <p>
                        Nullam dictum urna in urna vulputate convallis. Curabitur pellentesque molestie felis a cursus. In hac habitasse platea dictumst. Fusce scelerisque mollis elit vitae lacinia. Etiam iaculis sem dolor, non accumsan eros malesuada ac. Quisque imperdiet commodo enim, lacinia ultrices ante suscipit et. Nunc accumsan sagittis magna, non auctor ex iaculis quis. Donec dapibus purus vitae turpis lobortis condimentum. Phasellus viverra diam at neque facilisis consequat. Phasellus ut interdum nisi. Duis sed ante sed augue condimentum tincidunt.
                    </p>
                    <p>
                        Integer vestibulum erat non mollis tincidunt. Aliquam suscipit tincidunt ante sit amet tristique. Vestibulum non eros ullamcorper, gravida tellus in, vestibulum tortor. Donec dignissim augue nisi, vitae blandit orci lobortis ac. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Quisque ligula mi, congue in lectus a, molestie finibus lorem. Donec vel est urna. Praesent malesuada mauris eu ex tincidunt commodo. Vivamus arcu enim, luctus eu porttitor sit amet, posuere sit amet arcu. Aliquam et lacus felis. Sed egestas pellentesque iaculis. Ut in posuere massa, vitae pellentesque tortor.
                    </p>
                </div>
                
            </div>
            <div className='flex px-7 py-5 px-[200px]'>
                <div className='px-[200px]'>
                    <div className="pb-10">
                        <p className="text-lg font-bold">
                            What's so good about us?
                        </p>
                    </div>
                    <p>
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec a justo non tortor luctus dignissim. Curabitur ultrices risus et leo ornare bibendum. Mauris ligula odio, suscipit id orci non, imperdiet cursus tortor. Vivamus ut laoreet nunc. Pellentesque vehicula viverra mattis. Suspendisse commodo leo libero, in tempus magna luctus vel. Mauris sed rutrum velit. Vivamus lacinia posuere lacus, sit amet scelerisque nisi imperdiet vel. Nunc gravida, ante et ultrices rhoncus, orci eros porta odio, ut sodales justo urna sed elit. Praesent cursus velit diam, eu pharetra urna rhoncus sed. Donec cursus lorem ut purus hendrerit, non egestas arcu auctor. Cras eu elit quis justo convallis ultrices. Duis non finibus tortor. Donec et tincidunt ipsum. Aenean ut mi neque.
                    </p>
                    <p>
                        Aenean vehicula sapien a augue porttitor hendrerit. Suspendisse vitae ligula sodales, dignissim erat vel, elementum enim. Vestibulum vitae lectus porttitor, placerat turpis id, dapibus ipsum. Curabitur in sapien ut sem vehicula hendrerit rutrum ac nunc. Sed mollis auctor turpis varius imperdiet. Nulla lacus ex, consectetur ut lacus quis, lobortis lobortis velit. Mauris eu laoreet mauris. Nam dapibus, elit bibendum dignissim placerat, libero urna consequat sem, at imperdiet neque mauris ac augue. Quisque massa nisi, ullamcorper eget felis vitae, egestas varius sapien. Morbi vehicula maximus leo id interdum. Fusce in eros eget velit malesuada blandit sed at magna. Ut rhoncus ipsum urna, a ullamcorper justo volutpat at. Suspendisse posuere nulla at nulla tristique, id interdum enim vulputate. Suspendisse vel sem non erat feugiat convallis. Suspendisse congue tortor sit amet enim lobortis rutrum.
                    </p>
                    <p>
                        Praesent rutrum feugiat magna, ut eleifend mauris scelerisque a. Fusce non mollis lectus. Aenean auctor nulla id eros ullamcorper, non vehicula justo tincidunt. Morbi euismod urna sed neque euismod, efficitur lobortis neque consequat. Ut rhoncus vestibulum sagittis. Quisque a mi sit amet lacus volutpat suscipit. Praesent malesuada nibh vitae dolor porttitor, id fringilla turpis maximus. Maecenas eget sapien odio.
                    </p>
                    <p>
                        Nullam dictum urna in urna vulputate convallis. Curabitur pellentesque molestie felis a cursus. In hac habitasse platea dictumst. Fusce scelerisque mollis elit vitae lacinia. Etiam iaculis sem dolor, non accumsan eros malesuada ac. Quisque imperdiet commodo enim, lacinia ultrices ante suscipit et. Nunc accumsan sagittis magna, non auctor ex iaculis quis. Donec dapibus purus vitae turpis lobortis condimentum. Phasellus viverra diam at neque facilisis consequat. Phasellus ut interdum nisi. Duis sed ante sed augue condimentum tincidunt.
                    </p>
                    <p>
                        Integer vestibulum erat non mollis tincidunt. Aliquam suscipit tincidunt ante sit amet tristique. Vestibulum non eros ullamcorper, gravida tellus in, vestibulum tortor. Donec dignissim augue nisi, vitae blandit orci lobortis ac. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Quisque ligula mi, congue in lectus a, molestie finibus lorem. Donec vel est urna. Praesent malesuada mauris eu ex tincidunt commodo. Vivamus arcu enim, luctus eu porttitor sit amet, posuere sit amet arcu. Aliquam et lacus felis. Sed egestas pellentesque iaculis. Ut in posuere massa, vitae pellentesque tortor.
                    </p>
                </div>
                
            </div>
        </div>
    );
}